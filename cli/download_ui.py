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
from prompt_toolkit.output.color_depth import ColorDepth
from prompt_toolkit.key_binding import KeyBindings
from prompt_toolkit.styles import Style
from prompt_toolkit.formatted_text import HTML, Template
from prompt_toolkit.filters import Condition
from prompt_toolkit.layout.containers import (
    HSplit,
    VSplit,
    Window,
    FloatContainer,
    Float,
    ConditionalContainer,
    DynamicContainer,
)
from prompt_toolkit.layout.controls import FormattedTextControl, BufferControl
from prompt_toolkit.data_structures import Point
from prompt_toolkit.layout.layout import Layout
from prompt_toolkit.layout.menus import CompletionsMenu
from prompt_toolkit.widgets import (
    Frame,
    TextArea,
    Label,
    Button,
    Box,
    RadioList,
)
from prompt_toolkit.widgets.base import Border
from prompt_toolkit.formatted_text.utils import fragment_list_to_text
from functools import partial

from cli.color_utils import (
    console,
    interpolate_color,
    GRADIENT_PINK,
    GRADIENT_YELLOW,
    GRADIENT_BLUE,
    GRADIENT_BLUE_DARK,
    TOOL_COLOR,
    PROMPT_COLOR,
)

from cli.ui_rendering import show_loading
from cli.llamacpp import LLAMA_MODELS_DIR
from cli.completer import SlashCommandCompleter

class CustomFrame(Frame):
    def __init__(
        self,
        body,
        title="",
        style="",
        width=None,
        height=None,
        key_bindings=None,
        modal=False,
    ) -> None:
        self.title = title
        self.body = body
        self.is_dimmed = False

        # We'll use DynamicContainer to allow the title to change
        # and re-render the top row with correct gradients if needed.
        self.container = DynamicContainer(self._get_container)

    def _get_diag_style(self, row_idx, col_idx, total_rows, total_cols):
        """Calculate gradient style. Use horizontal gradient for all border characters to match Yips style."""
        if self.is_dimmed:
            return "#444444"

        # Purely horizontal progress for borders to match Yips agent's style
        progress = col_idx / max(total_cols - 1, 1)
        
        r, g, b = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, progress)
        return f"#{r:02x}{g:02x}{b:02x}"

    def _get_container(self):
        # Determine total rows for gradient calculation
        total_rows = 15 
        total_cols = console.width or 80

        # Title formatting: "Yips" (gradient) + " Model Downloader" (blue)
        title_text = []
        prefix = "╭─── "
        for i, char in enumerate(prefix):
            style = self._get_diag_style(0, i, total_rows, total_cols)
            title_text.append((style, char))
        
        # Split title for specific styling
        full_title = fragment_list_to_text(self.title) if not isinstance(self.title, str) else self.title
        
        if "Yips" in full_title:
            parts = full_title.split("Yips", 1)
            # "Yips" with its own gradient from the start of its position
            yips_str = "Yips"
            for i, char in enumerate(yips_str):
                if self.is_dimmed:
                    style = "#555555"
                else:
                    progress = i / max(len(yips_str) - 1, 1)
                    r, g, b = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, progress)
                    style = f"#{r:02x}{g:02x}{b:02x}"
                title_text.append((style, char))
            
            # Rest of the title
            rest = parts[1]
            if rest:
                # Add the space after Yips
                title_text.append((self._get_diag_style(0, len(title_text), total_rows, total_cols), " "))
                
                # "Model Downloader" in Blue
                blue_hex = f"#{GRADIENT_BLUE[0]:02x}{GRADIENT_BLUE[1]:02x}{GRADIENT_BLUE[2]:02x}"
                if self.is_dimmed: blue_hex = "#555555"
                
                # Strip the leading space from 'rest' if it was " Model Downloader"
                rest_display = rest.strip()
                for char in rest_display:
                    title_text.append((blue_hex, char))
        else:
            # Fallback
            for i, char in enumerate(full_title):
                style = self._get_diag_style(0, len(prefix) + i, total_rows, total_cols)
                title_text.append((style, char))

        # Add space after title
        title_len = len(title_text)
        title_text.append((self._get_diag_style(0, title_len, total_rows, total_cols), " "))
        title_len += 1

        # Fill the rest of the top line with gradient characters
        top_elements = []
        top_elements.append(Window(content=FormattedTextControl(title_text), height=1, dont_extend_width=True))
        
        remaining = total_cols - title_len - 1 # -1 for the corner
        for i in range(remaining):
            top_elements.append(Window(width=1, height=1, char=Border.HORIZONTAL, 
                                     style=partial(self._get_diag_style, 0, title_len + i, total_rows, total_cols)))
        
        top_elements.append(Window(width=1, height=1, char="╮", 
                                 style=partial(self._get_diag_style, 0, total_cols - 1, total_rows, total_cols)))

        # Bottom row
        bottom_elements = []
        bottom_elements.append(Window(width=1, height=1, char="╰", 
                                    style=partial(self._get_diag_style, total_rows-1, 0, total_rows, total_cols)))
        for i in range(1, total_cols - 1):
            bottom_elements.append(Window(width=1, height=1, char=Border.HORIZONTAL, 
                                        style=partial(self._get_diag_style, total_rows-1, i, total_rows, total_cols)))
        bottom_elements.append(Window(width=1, height=1, char="╯", 
                                    style=partial(self._get_diag_style, total_rows-1, total_cols-1, total_rows, total_cols)))

        return HSplit([
            VSplit(top_elements, height=1),
            VSplit([
                Window(width=1, char=Border.VERTICAL, style=partial(self._get_diag_style, 5, 0, total_rows, total_cols)),
                self.body,
                Window(width=1, char=Border.VERTICAL, style=partial(self._get_diag_style, 5, total_cols-1, total_rows, total_cols)),
            ]),
            VSplit(bottom_elements, height=1),
        ])

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
            "Trending": "trendingScore",
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
            "expand": ["lastModified", "pipeline_tag", "downloads", "likes", "gguf"]
        }
        if search:
            params["search"] = search
        if author:
            params["author"] = author

        try:
            models = self.api.list_models(**params)
            results = []
            for m in models:
                # Filter for text-generation related models if it's a general list
                # but be lenient to include models with no pipeline_tag (like many GGUF quants)
                p_tag = getattr(m, 'pipeline_tag', None)
                if not search and not author:
                    if p_tag and p_tag not in ["text-generation", "conversational", "text2text-generation"]:
                        continue

                # Filter by size if gguf info is available
                gguf_info = getattr(m, 'gguf', None)
                if gguf_info and 'total' in gguf_info:
                    size_gb = gguf_info['total'] / (1024 * 1024 * 1024)
                    # Use the same 1.2x heuristic as can_run_model
                    if size_gb > TOTAL_MEM_GB * 1.2:
                        continue

                results.append({
                    "id": m.id,
                    "downloads": getattr(m, 'downloads', 0) or 0,
                    "likes": getattr(m, 'likes', 0) or 0,
                    "last_modified": getattr(m, 'lastModified', None),
                    "author": getattr(m, 'author', "Unknown") or "Unknown",
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
            for sort in ["Downloads", "Trending", "Updated"]:
                manager.list_gguf_models(sort=sort)
            cls._is_precaching = False
            
        threading.Thread(target=_task, daemon=True).start()

    def get_model_files(self, model_id: str) -> List[Dict]:
        """Get GGUF files for a specific model."""
        try:
            # Use list_repo_tree with recursive=True to find all .gguf files
            files_info = [f for f in self.api.list_repo_tree(model_id, recursive=True) 
                         if f.path.endswith(".gguf")]
            
            results = []
            for f in files_info:
                # Calculate quantization from name (e.g. Q4_K_M)
                quant = "Unknown"
                path_str = f.path.upper()
                if "Q4_K_M" in path_str: quant = "Q4_K_M (Balanced)"
                elif "Q5_K_M" in path_str: quant = "Q5_K_M (High Quality)"
                elif "Q8_0" in path_str: quant = "Q8_0 (Max Quality)"
                elif "Q2_K" in path_str: quant = "Q2_K (Max Speed)"
                else:
                    # Extract roughly
                    import re
                    match = re.search(r'(Q\d_[A-Z0-9_]+)', path_str)
                    if match:
                        quant = match.group(1)
                
                size_bytes = getattr(f, 'size', None)
                can_run, reason = can_run_model(size_bytes)
                
                results.append({
                    "filename": f.path,
                    "size": size_bytes,
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
        self.is_dimmed = False
        
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
            "search_prompt": "#ffccff",
        })

        # --- Widgets ---
        
        self.search_area = TextArea(
            multiline=False, 
            prompt=[("class:search_prompt", ">>> 🔍 ")],
            style="class:input",
            completer=SlashCommandCompleter(),
            accept_handler=self._on_search
        )
        self.search_area.buffer.on_text_changed += self._on_text_changed
        self._search_task = None
        
        # Tabs
        self.tab_container = Window(
            content=FormattedTextControl(self._get_tabs_text),
            height=1
        )
        
        # Model List
        self.model_list_control = FormattedTextControl(
            text=self._get_model_list_text,
            focusable=True,
            show_cursor=False,
            key_bindings=self._get_list_key_bindings(),
            get_cursor_position=self._get_model_list_cursor_position
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
            show_cursor=False,
            key_bindings=self._get_file_list_key_bindings(),
            get_cursor_position=self._get_file_list_cursor_position
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
                    FormattedTextControl(f"RAM+VRAM: {TOTAL_MEM_GB:.1f}GB | Disk: {DISK_FREE_GB:.1f}GB "), 
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
        framed_content = CustomFrame(
            main_content,
            title="Yips Model Downloader"
        )
        
        self.root_container = HSplit([
            framed_content,
            Box(self.search_area, padding=0),
        ])
        
        # We need a FloatContainer to show the completion menu (and other popups)
        self.floats = [
            Float(xcursor=True,
                  ycursor=True,
                  content=CompletionsMenu(max_height=16))
        ]
        self.main_layout_container = FloatContainer(
            content=self.root_container,
            floats=self.floats
        )
        
        self.layout = Layout(self.main_layout_container, focused_element=self.search_area)
        
        self.kb = KeyBindings()
        self._setup_global_bindings()
        
        self.app = Application(
            layout=self.layout,
            key_bindings=self.kb,
            style=self.style,
            full_screen=False,
            mouse_support=True,
            color_depth=ColorDepth.TRUE_COLOR
        )

    def _get_model_list_cursor_position(self):
        row = self.selected_model_index - self.list_scroll_offset
        return Point(x=0, y=row)

    def _get_file_list_cursor_position(self):
        # The file list has a header of 2 lines
        return Point(x=0, y=self.selected_file_index + 2)

    def _get_tabs_text(self):
        tabs = ["Most Downloaded", "Top Rated", "Newest"]
        result = []
        total_cols = console.width or 80
        
        current_pos = 0
        for t in tabs:
            display_t = f" {t} "
            if t == self.current_tab:
                if self.is_dimmed:
                    result.append(("bg:#555555 #000000 bold", display_t))
                else:
                    for i, char in enumerate(display_t):
                        # Horizontal gradient mapped to the tab width
                        progress = i / max(len(display_t) - 1, 1)
                        r, g, b = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, progress)
                        # Use black text for highlighted elements
                        result.append((f"bg:#{r:02x}{g:02x}{b:02x} #000000 bold", char))
            else:
                result.append(("class:tab.inactive", display_t))
            
            result.append(("", " "))
            current_pos += len(display_t) + 1
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
        height = 12
        start = self.list_scroll_offset
        end = start + height
        total_cols = console.width or 80
        total_rows = 15 # Approximate total rows for gradient
        
        visible_items = self.models_data[start:end]
        is_focused = self.layout.has_focus(self.model_list_control)
        
        for i, model in enumerate(visible_items):
            real_idx = start + i
            is_selected = (real_idx == self.selected_model_index)
            
            name = model['id']
            if len(name) > 50: name = name[:47] + "..."
            
            downloads = f"{model['downloads']/1000:.1f}k" if model['downloads'] > 1000 else str(model['downloads'])
            
            last_mod = "Unknown"
            if model['last_modified']:
                if isinstance(model['last_modified'], datetime):
                    last_mod = model['last_modified'].strftime('%Y-%m-%d')
                else:
                    last_mod = str(model['last_modified'])[:10]

            cursor = ">" if is_selected else " "
            text = f"{cursor} {name:<50} | ↓ {downloads:<6} | {last_mod}"
            
            if is_selected:
                if self.is_dimmed:
                    lines.append(("bg:#555555 #000000", text + "\n"))
                else:
                    for col, char in enumerate(text):
                        if col == 0 and is_focused:
                            # Only the cursor character gets solid pink background when focused
                            lines.append(("bg:#ffccff #000000", char))
                        else:
                            # The rest of the line (or everything if not focused) uses the gradient
                            progress = col / max(len(text) - 1, 1)
                            r, g, b = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, progress)
                            lines.append((f"bg:#{r:02x}{g:02x}{b:02x} #000000", char))
                    lines.append(("", "\n"))
            else:
                lines.append(("", text + "\n"))
            
        return lines

    def _get_file_list_text(self):
        if not self.files_data:
            return "No compatible files found."
            
        lines = []
        lines.append(("", f"Select quantization for {self.selected_model_id}:\n\n"))
        total_cols = console.width or 80
        total_rows = 15
        is_focused = self.layout.has_focus(self.file_list_control)
        
        for i, f in enumerate(self.files_data):
            is_selected = (i == self.selected_file_index)
            
            size_val = f['size'] or 0
            size_gb = size_val / (1024*1024*1024)
            fname = f['filename']
            if "/" in fname: fname = fname.split("/")[-1]
            
            status = "OK" if f['can_run'] else "⚠️ TOO LARGE"
            status_style = "fg:ansired" if not f['can_run'] else "fg:ansigreen"
            
            cursor = ">" if is_selected else " "
            text = f"{cursor} {fname:<40} | {f['quant']:<15} | {size_gb:.1f} GB | "
            
            if is_selected:
                full_selected_text = text + status
                if self.is_dimmed:
                    lines.append(("bg:#555555 #000000", full_selected_text + "\n"))
                else:
                    for col, char in enumerate(full_selected_text):
                        if col == 0 and is_focused:
                            # Only the cursor character gets solid pink background when focused
                            lines.append(("bg:#ffccff #000000", char))
                        else:
                            # The rest of the line uses the gradient
                            progress = col / max(len(full_selected_text) - 1, 1)
                            r, g, b = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, progress)
                            lines.append((f"bg:#{r:02x}{g:02x}{b:02x} #000000", char))
                    lines.append(("", "\n"))
            else:
                lines.append(("", text))
                lines.append((status_style, f"{status}\n"))
            
        return lines
            
        return lines

    def _setup_global_bindings(self):
        @self.kb.add("escape")
        def _(event):
            # Apply dimmed style for "greyed out" look on exit
            self.is_dimmed = True
            # Find the CustomFrame(s) and dim them
            for container in self.layout.container.get_children():
                if isinstance(container, CustomFrame):
                    container.is_dimmed = True
                # Recursive search if needed, but here they are top-level
            
            # If the layout is currently showing a popup, it's a FloatContainer
            if isinstance(self.layout.container, FloatContainer):
                for f in self.layout.container.floats:
                    if isinstance(f.content, CustomFrame):
                        f.content.is_dimmed = True
                # Also dim the base content
                if isinstance(self.layout.container.content, CustomFrame):
                    self.layout.container.content.is_dimmed = True

            dim_style = Style.from_dict({
                "frame.border": "#444444", 
                "frame.label": "#555555",
                "header": "#555555 bg:#222222",
                "tab.active": "#555555", 
                "tab.inactive": "#444444",
                "list-item.selected": "#555555",
                "status": "#444444",
                "error": "#444444",
                "input": "#444444",
                "search_prompt": "#444444",
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
            # Remove the popup float (last one added)
            if len(self.floats) > 1:
                self.floats.pop()
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

    def _on_text_changed(self, _):
        """Triggered on every keystroke in the search bar."""
        self.search_query = self.search_area.text
        
        # We need an event loop to schedule the background refresh
        try:
            loop = asyncio.get_event_loop()
            if self._search_task:
                self._search_task.cancel()
            
            # Use the app's create_background_task if available, or just the loop
            if hasattr(self, 'app') and self.app:
                self._search_task = self.app.create_background_task(self._do_live_search())
            else:
                self._search_task = loop.create_task(self._do_live_search())
        except Exception:
            # Fallback if no loop is available (unlikely in prompt_toolkit 3)
            pass

    async def _do_live_search(self):
        """Async task to debounce and fetch results."""
        try:
            await asyncio.sleep(0.3) # Debounce delay
            
            # Determine sort mode
            sort_mode = "Downloads"
            if self.current_tab == "Top Rated":
                sort_mode = "Trending"
            elif self.current_tab == "Newest":
                sort_mode = "Updated"

            # Execute blocking API call in a thread
            loop = asyncio.get_event_loop()
            results = await loop.run_in_executor(
                None,
                partial(self.manager.list_gguf_models, sort=sort_mode, search=self.search_query, limit=100)
            )

            self.models_data = results
            self.selected_model_index = 0
            self.list_scroll_offset = 0
            
            # Request UI re-render
            if hasattr(self, 'app') and self.app:
                self.app.invalidate()
        except asyncio.CancelledError:
            pass # Task was cancelled by a newer keystroke
        except Exception:
            self.models_data = []
            if hasattr(self, 'app') and self.app:
                self.app.invalidate()

    def _on_search(self, buff):
        text = self.search_area.text.strip()
        if text.startswith("/"):
            self.app.exit(result=text)
            return False # Don't keep text
            
        # If results are already there from live search, just focus the list
        if self.models_data:
            self.app.layout.focus(self.model_list_window)
        else:
            # Fallback to manual refresh if live search hasn't finished
            self.search_query = self.search_area.text
            self.refresh_data()
            
        return True

    def refresh_data(self):
        """Synchronous refresh for initial load or when async is not available."""
        # Adjust params based on tabs
        sort_mode = "Downloads"
        if self.current_tab == "Top Rated":
            sort_mode = "Trending"
        elif self.current_tab == "Newest":
            sort_mode = "Updated"
        
        # If app is running, use async version to avoid blocking
        if hasattr(self, 'app') and self.app.is_running:
            if self._search_task:
                self._search_task.cancel()
            self._search_task = self.app.create_background_task(self._do_live_search())
            return

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
        
        popup_body = CustomFrame(
            Window(self.file_list_control),
            title=f"Files for {model_id}"
        )
        
        # Add the popup to existing floats (keep completion menu etc)
        self.floats.append(
            Float(
                content=popup_body,
                top=5, bottom=5, left=10, right=10
            )
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
