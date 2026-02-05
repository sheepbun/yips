"""
Interactive TUI for downloading models from Hugging Face Hub.
"""

import os
import shutil
import asyncio
from typing import List, Dict, Optional, Tuple
from datetime import datetime
from pathlib import Path

from huggingface_hub import HfApi
from huggingface_hub.utils import RepositoryNotFoundError

from prompt_toolkit import Application
from prompt_toolkit.layout.containers import (
    HSplit,
    VSplit,
    Window,
    FloatContainer,
    Float,
)
from prompt_toolkit.layout.controls import FormattedTextControl, BufferControl
from prompt_toolkit.layout.layout import Layout
from prompt_toolkit.widgets import (
    Frame,
    TextArea,
    Label,
    Button,
    Box,
    RadioList,
)
from prompt_toolkit.key_binding import KeyBindings
from prompt_toolkit.styles import Style
from prompt_toolkit.formatted_text import HTML
from prompt_toolkit.filters import Condition

from cli.color_utils import console
from cli.ui_rendering import show_loading
from cli.llamacpp import LLAMA_MODELS_DIR

# --- System Info & Hardware Filtering ---

def get_system_ram_gb() -> float:
    """Get total system RAM in GB."""
    try:
        with open("/proc/meminfo", "r") as f:
            for line in f:
                if "MemTotal" in line:
                    # format: MemTotal:       16306516 kB
                    parts = line.split()
                    kb = int(parts[1])
                    return kb / (1024 * 1024)
    except Exception:
        return 8.0 # Fallback assumption

def get_vram_gb() -> float:
    """Get total VRAM in GB (best effort for NVIDIA/AMD)."""
    try:
        # Try nvidia-smi
        import subprocess
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=memory.total", "--format=csv,noheader,nounits"],
            capture_output=True, text=True
        )
        if result.returncode == 0:
            total_vram = 0
            for line in result.stdout.strip().split('\n'):
                if line.strip():
                    total_vram += int(line)
            return total_vram / 1024
    except Exception:
        pass
    
    # Check for AMD (amdgpu)
    try:
        import glob
        total_vram = 0
        found = False
        for path in glob.glob("/sys/class/drm/card*/device/mem_info_vram_total"):
            with open(path, 'r') as f:
                total_vram += int(f.read())
            found = True
        if found:
            return total_vram / (1024 * 1024 * 1024)
    except Exception:
        pass

    return 0.0

def get_disk_free_gb(path: str) -> float:
    """Get free disk space in GB for the given path."""
    try:
        if not os.path.exists(path):
            os.makedirs(path, exist_ok=True)
        total, used, free = shutil.disk_usage(path)
        return free / (1024 * 1024 * 1024)
    except Exception:
        return 10.0 # Fallback

SYSTEM_RAM_GB = get_system_ram_gb()
SYSTEM_VRAM_GB = get_vram_gb()
TOTAL_MEM_GB = SYSTEM_RAM_GB + SYSTEM_VRAM_GB
DISK_FREE_GB = get_disk_free_gb(str(LLAMA_MODELS_DIR))

def can_run_model(size_bytes: int) -> Tuple[bool, str]:
    """Check if model can run based on size vs RAM/Disk."""
    if not size_bytes:
        return True, "Unknown Size"
        
    size_gb = size_bytes / (1024 * 1024 * 1024)
    
    if size_gb > DISK_FREE_GB:
        return False, f"Not enough disk space ({size_gb:.1f}GB > {DISK_FREE_GB:.1f}GB)"
    
    # Heuristic: Check against total available memory (RAM + VRAM)
    # We allow it if it fits in Total Memory * 1.2 (assuming some swap/compression)
    if size_gb > TOTAL_MEM_GB * 1.2:
        return False, f"Model too large ({size_gb:.1f}GB > {TOTAL_MEM_GB:.1f}GB)"
        
    return True, "OK"


# --- HF API Wrapper ---

class HFModelManager:
    _cache = {} # Global cache for precaching: {sort_mode: [models]}
    _is_precaching = False

    def __init__(self):
        self.api = HfApi()
        
    def list_gguf_models(self, 
                        sort: str = "downloads", 
                        limit: int = 50, 
                        search: str = None,
                        author: str = None) -> List[Dict]:
        """List GGUF models from HF, using cache if available and no search query."""
        
        # Mapping UI sort to HF API sort
        sort_map = {
            "Downloads": "downloads",
            "Likes": "likes", 
            "Updated": "lastModified"
        }
        sort_key = sort_map.get(sort, "downloads")
        
        # Use cache if it's a standard top-level list request (no search/author)
        if not search and not author and sort in self._cache:
            return self._cache[sort]

        params = {
            "filter": "gguf",
            "sort": sort_key,
            "limit": limit,
        }
        if search:
            params["search"] = search
        if author:
            params["author"] = author

        try:
            models = self.api.list_models(**params)
            results = []
            for m in models:
                results.append({
                    "id": m.modelId,
                    "downloads": m.downloads,
                    "likes": m.likes,
                    "last_modified": m.lastModified,
                    "author": m.author,
                })
            
            # Update cache for standard requests
            if not search and not author:
                self._cache[sort] = results
                
            return results
        except Exception as e:
            return []

    @classmethod
    def precache_background(cls):
        """Start a background thread to fetch all tab data."""
        if cls._is_precaching:
            return
        cls._is_precaching = True
        
        import threading
        def _task():
            manager = HFModelManager()
            # Precache all tabs
            for sort in ["Downloads", "Likes", "Updated"]:
                manager.list_gguf_models(sort=sort)
            cls._is_precaching = False
            
        threading.Thread(target=_task, daemon=True).start()

    def get_model_files(self, model_id: str) -> List[Dict]:
        """Get GGUF files for a specific model."""
        try:
            # list_files_info is the one.
            files_info = list(self.api.list_files_info(model_id, paths="*.gguf"))
            
            results = []
            for f in files_info:
                # Calculate quantization from name (e.g. Q4_K_M)
                quant = "Unknown"
                if "Q4_K_M" in f.path: quant = "Q4_K_M (Balanced)"
                elif "Q5_K_M" in f.path: quant = "Q5_K_M (High Quality)"
                elif "Q8_0" in f.path: quant = "Q8_0 (Max Quality)"
                elif "Q2_K" in f.path: quant = "Q2_K (Max Speed)"
                else:
                    # Extract roughly
                    import re
                    match = re.search(r'(Q\d_[A-Z0-9_]+)', f.path, re.IGNORECASE)
                    if match:
                        quant = match.group(1)
                
                can_run, reason = can_run_model(f.size)
                
                results.append({
                    "filename": f.path,
                    "size": f.size,
                    "quant": quant,
                    "can_run": can_run,
                    "reason": reason
                })
            
            # Sort by size usually helps (smallest to largest) or by quantization
            results.sort(key=lambda x: x['size'] if x['size'] else 0)
            return results
            
        except Exception as e:
            return []


# --- TUI Implementation ---

class DownloadUI:
    def __init__(self):
        self.manager = HFModelManager()
        self.models_data = []
        self.selected_model_id = None
        self.files_data = []
        
        # State
        self.current_tab = "Most Downloaded" # Most Downloaded, Top Rated, Newest
        self.current_provider = "TheBloke" 
        self.current_sort = "Downloads" # Controlled by Tab now
        self.search_query = ""
        self.active_view = "model_list" # model_list, file_list, download_confirm
        
        self.style = Style.from_dict({
            "frame.border": "#5f00ff", 
            "frame.label": "bold #ffff00",
            "header": "#5f00ff bold", # Purple text for headers
            "tab.active": "bg:#5f00ff #ffffff bold", 
            "tab.inactive": "#888888",
            "list-item.selected": "bg:#5f00ff #ffffff",
            "status": "#888888",
            "error": "#ff0000",
            "input": "#ffccff",
        })

        # --- Widgets ---
        
        # Search Bar (Moved to bottom)
        self.search_area = TextArea(
            multiline=False, 
            prompt=HTML('<style fg="#ffccff">>>> 🔍</style>'),
            style="class:input",
            accept_handler=self._on_search
        )
        
        # Tabs
        self.tab_container = Window(
            content=FormattedTextControl(self._get_tabs_text),
            height=1
        )
        
        # Model List
        self.model_list_control = FormattedTextControl(
            text=self._get_model_list_text,
            focusable=True,
            key_bindings=self._get_list_key_bindings()
        )
        self.model_list_window = Window(
            content=self.model_list_control,
            height=12
        )
        self.selected_model_index = 0
        self.list_scroll_offset = 0
        
        # File List (Popup/Overlay)
        self.file_list_control = FormattedTextControl(
            text=self._get_file_list_text,
            focusable=True,
            key_bindings=self._get_file_list_key_bindings()
        )
        self.selected_file_index = 0
        
        # Layout construction
        
        # Main content inside the frame
        main_content = HSplit([
            # Top Row: Tabs | Spacer | Info
            VSplit([
                # Use a narrower container for tabs to allow the spacer to work
                Window(content=FormattedTextControl(self._get_tabs_text), height=1, dont_extend_width=True),
                Window(), # Flexible spacer
                Window(
                    FormattedTextControl(f"RAM+VRAM: {TOTAL_MEM_GB:.1f}GB | Disk: {DISK_FREE_GB:.1f}GB"), 
                    style="class:status", 
                    align="right", 
                    dont_extend_width=True
                ),
            ], height=1),
            
            # Separator
            Window(height=1, char=" "),
            
            # The List
            self.model_list_window,
            
            # Status footer inside box
            Window(FormattedTextControl(self._get_status_text), height=1, style="class:status"),
        ])
        
        # Framed content
        framed_content = Frame(
            main_content,
            title="Yips Model Downloader",
            style="class:frame.border"
        )
        
        self.root_container = HSplit([
            framed_content,
            Box(self.search_area, padding=0),
        ])
        
        self.layout = Layout(self.root_container, focused_element=self.search_area)
        
        self.kb = KeyBindings()
        self._setup_global_bindings()
        
        self.app = Application(
            layout=self.layout,
            key_bindings=self.kb,
            style=self.style,
            full_screen=False,
            mouse_support=True
        )

    def _get_tabs_text(self):
        tabs = ["Most Downloaded", "Top Rated", "Newest"]
        result = []
        for t in tabs:
            if t == self.current_tab:
                result.append(("class:tab.active", f" {t} "))
            else:
                result.append(("class:tab.inactive", f" {t} "))
            result.append(("", " "))
        return result

    def _get_status_text(self):
        if self.active_view == "model_list":
            return " [Tab] Focus  [Enter] Select  [←/→] Sort By  [Esc] Quit"
        elif self.active_view == "file_list":
            return " [Enter] Download  [Esc] Back"
        return ""

    def _get_model_list_text(self):
        if not self.models_data:
            return "Loading or no models found..."
            
        lines = []
        # Calculate visible range based on height (approximate)
        # Fixed height 12
        height = 12
        start = self.list_scroll_offset
        end = start + height
        
        visible_items = self.models_data[start:end]
        
        for i, model in enumerate(visible_items):
            real_idx = start + i
            style = "class:list-item.selected" if real_idx == self.selected_model_index else ""
            
            name = model['id']
            if len(name) > 50: name = name[:47] + "..."
            
            # Format numbers
            downloads = f"{model['downloads']/1000:.1f}k" if model['downloads'] > 1000 else str(model['downloads'])
            
            last_mod = "Unknown"
            if model['last_modified']:
                # Handle both datetime and string (API variations)
                if isinstance(model['last_modified'], datetime):
                    last_mod = model['last_modified'].strftime('%Y-%m-%d')
                else:
                    last_mod = str(model['last_modified'])[:10]

            text = f" {name:<50} | ↓ {downloads:<6} | {last_mod}"
            lines.append((style, text + "\n"))
            
        return lines

    def _get_file_list_text(self):
        if not self.files_data:
            return "No compatible files found."
            
        lines = []
        lines.append(("", f"Select quantization for {self.selected_model_id}:\n\n"))
        
        for i, f in enumerate(self.files_data):
            style = "class:list-item.selected" if i == self.selected_file_index else ""
            
            size_val = f['size'] or 0
            size_gb = size_val / (1024*1024*1024)
            fname = f['filename']
            # Only show filename part
            if "/" in fname: fname = fname.split("/")[-1]
            
            status = "OK" if f['can_run'] else "⚠️ TOO LARGE"
            status_style = "fg:ansired" if not f['can_run'] else "fg:ansigreen"
            
            text = f" {fname:<40} | {f['quant']:<15} | {size_gb:.1f} GB | "
            
            lines.append((style, text))
            lines.append((status_style, f"{status}\n"))
            
        return lines

    def _setup_global_bindings(self):
        @self.kb.add("escape")
        def _(event):
            # Apply dimmed style for "greyed out" look on exit
            dim_style = Style.from_dict({
                "frame.border": "#444444", 
                "frame.label": "#555555",
                "header": "#555555 bg:#222222",
                "tab.active": "#555555", 
                "tab.inactive": "#444444",
                "list-item.selected": "#555555",
                "status": "#444444",
                "error": "#444444",
                "input": "#555555",
            })
            event.app.style = dim_style
            event.app.exit()
            
        @self.kb.add("tab")
        def _(event):
            if self.app.layout.has_focus(self.search_area):
                self.app.layout.focus(self.model_list_window)
            else:
                self.app.layout.focus(self.search_area)

    def _get_list_key_bindings(self):
        kb = KeyBindings()
        
        @kb.add("left")
        def _(event):
            # Cycle tabs left
            tabs = ["Most Downloaded", "Top Rated", "Newest"]
            curr_idx = tabs.index(self.current_tab)
            self.current_tab = tabs[(curr_idx - 1) % len(tabs)]
            self.refresh_data()

        @kb.add("right")
        def _(event):
            # Cycle tabs right
            tabs = ["Most Downloaded", "Top Rated", "Newest"]
            curr_idx = tabs.index(self.current_tab)
            self.current_tab = tabs[(curr_idx + 1) % len(tabs)]
            self.refresh_data()
        
        @kb.add("up")
        def _(event):
            self.selected_model_index = max(0, self.selected_model_index - 1)
            # Scroll up if needed
            if self.selected_model_index < self.list_scroll_offset:
                self.list_scroll_offset = self.selected_model_index
                
        @kb.add("down")
        def _(event):
            self.selected_model_index = min(len(self.models_data) - 1, self.selected_model_index + 1)
            # Scroll down if needed
            # Fixed height 12
            height = 12
            if self.selected_model_index >= self.list_scroll_offset + height:
                self.list_scroll_offset = self.selected_model_index - height + 1

        @kb.add("enter")
        def _(event):
            if self.models_data:
                self.open_file_selection(self.models_data[self.selected_model_index]['id'])
        
        return kb

    def _get_file_list_key_bindings(self):
        kb = KeyBindings()
        
        @kb.add("up")
        def _(event):
            self.selected_file_index = max(0, self.selected_file_index - 1)
            
        @kb.add("down")
        def _(event):
            self.selected_file_index = min(len(self.files_data) - 1, self.selected_file_index + 1)
            
        @kb.add("escape")
        def _(event):
            # Close popup
            self.active_view = "model_list"
            self.layout.container = self.root_container
            self.app.layout.focus(self.model_list_window)

        @kb.add("enter")
        def _(event):
            if self.files_data:
                selected = self.files_data[self.selected_file_index]
                if not selected['can_run']:
                    # User asked to "not populate" bad ones,
                    # but we are showing them with a warning status.
                    # We will block selection to be safe.
                    # Just return, do nothing
                    return
                else:
                    event.app.exit(result=selected)
        
        return kb

    def _on_search(self, buff):
        text = self.search_area.text.strip()
        if text.startswith("/"):
            self.app.exit(result=text)
            return False # Don't keep text
            
        self.search_query = self.search_area.text
        self.refresh_data()
        # Keep focus on search area so user can keep typing
        return True

    def refresh_data(self):
        # Fetch data
        self.models_data = []
        
        # Adjust params based on tabs
        # "Top Rated" maps to Likes
        # "Newest" -> lastModified
        sort_mode = "Downloads"
        if self.current_tab == "Top Rated":
            sort_mode = "Likes"
        elif self.current_tab == "Newest":
            sort_mode = "Updated"
        
        try:
            results = self.manager.list_gguf_models(
                sort=sort_mode,
                search=self.search_query,
                limit=100
            )
            self.models_data = results
            self.selected_model_index = 0
            self.list_scroll_offset = 0
        except Exception:
            self.models_data = []

    def open_file_selection(self, model_id):
        self.selected_model_id = model_id
        self.active_view = "file_list"
        
        # Fetch files
        files = self.manager.get_model_files(model_id)
        self.files_data = files
        self.selected_file_index = 0
        
        # Switch layout to show overlay
        # We create a FloatContainer wrapping the root
        
        popup_body = Frame(
            Window(self.file_list_control),
            title=f"Files for {model_id}",
            style="class:dialog"
        )
        
        self.layout.container = FloatContainer(
            content=self.root_container,
            floats=[
                Float(
                    content=popup_body,
                    top=5, bottom=5, left=10, right=10
                )
            ]
        )
        self.app.layout.focus(self.file_list_control)

    def run(self):
        # Initial fetch
        self.refresh_data()
        return self.app.run()


def run_download_ui():
    """Entry point."""
    ui = DownloadUI()
    result = ui.run()
    
    if isinstance(result, str):
        return result
        
    if result:
        # Download the file
        file_info = result
        model_id = ui.selected_model_id
        filename = file_info['filename']
        
        console.print(f"[cyan]Downloading {filename} from {model_id}...[/cyan]")
        
        from huggingface_hub import hf_hub_download
        try:
            local_dir = LLAMA_MODELS_DIR / model_id
            
            path = hf_hub_download(
                repo_id=model_id,
                filename=filename,
                local_dir=local_dir,
                local_dir_use_symlinks=False
            )
            
            console.print(f"[green]Successfully downloaded to:[/green] {path}")
            # Show friendly path relative to home if possible
            display_path = str(path)
            if str(Path.home()) in display_path:
                display_path = display_path.replace(str(Path.home()), "~")
                
            console.print(f"[dim]To use this model:[/dim] [bold]/model {model_id}/{os.path.basename(path)}[/bold]")
            
        except Exception as e:
            console.print(f"[red]Download failed: {e}[/red]")

if __name__ == "__main__":
    from pathlib import Path # Ensure Path is available in __main__
    run_download_ui()
