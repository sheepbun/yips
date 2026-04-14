"""
Interactive TUI for downloading models from Hugging Face Hub.
"""

import os
import shutil
import asyncio
import typing
import time
from typing import Optional, Any, Union
from datetime import datetime
from pathlib import Path
from urllib.parse import quote
from urllib.request import Request, urlopen

from huggingface_hub import HfApi  # type: ignore[reportUnknownVariableType]

from prompt_toolkit import Application
from prompt_toolkit.output.color_depth import ColorDepth
from prompt_toolkit.key_binding import KeyBindings
from prompt_toolkit.styles import Style
from prompt_toolkit.formatted_text import AnyFormattedText, to_formatted_text, StyleAndTextTuples
from prompt_toolkit.key_binding.key_processor import KeyPressEvent
from prompt_toolkit.layout.containers import (
    HSplit,
    VSplit,
    Window,
    FloatContainer,
    Float,
    DynamicContainer,
    AnyContainer,
    WindowAlign,
)
from prompt_toolkit.layout.controls import FormattedTextControl
from prompt_toolkit.layout.dimension import AnyDimension
from prompt_toolkit.data_structures import Point
from prompt_toolkit.layout.layout import Layout
from prompt_toolkit.layout.menus import MultiColumnCompletionsMenu
from prompt_toolkit.widgets import (
    Frame,
    TextArea,
    Box,
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
)

from cli.llamacpp import LLAMA_MODELS_DIR
from cli.completer import SlashCommandCompleter

class CustomFrame(Frame):
    def __init__(
        self,
        body: AnyContainer,
        title: AnyFormattedText = "",
        style: str = "",
        width: AnyDimension = None,
        height: AnyDimension = None,
        key_bindings: Optional[KeyBindings] = None,
        modal: bool = False,
    ) -> None:
        self.title = title
        self.body = body
        self.is_dimmed = False

        # We'll use DynamicContainer to allow the title to change
        # and re-render the top row with correct gradients if needed.
        self.container = DynamicContainer(self._get_container)

    def _get_diag_style(self, row_idx: int, col_idx: int, total_rows: int, total_cols: int) -> str:
        """Calculate gradient style. Use horizontal gradient for all border characters to match Yips style."""
        if self.is_dimmed:
            return "#444444"

        # Purely horizontal progress for borders to match Yips agent's style
        progress = col_idx / max(total_cols - 1, 1)
        
        r, g, b = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, progress)
        return f"#{r:02x}{g:02x}{b:02x}"

    def _get_container(self) -> AnyContainer:
        # Determine total rows for gradient calculation
        total_rows = 15 
        total_cols = console.width or 80

        # Title formatting: "Yips" (gradient) + " Model Downloader" (blue)
        title_text: StyleAndTextTuples = []
        prefix = "╭─── "
        for i, char in enumerate(prefix):
            style = self._get_diag_style(0, i, total_rows, total_cols)
            title_text.append((style, char))
        
        # Split title for specific styling
        full_title = fragment_list_to_text(to_formatted_text(self.title))
        
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
        top_elements: list[AnyContainer] = []
        top_elements.append(Window(content=FormattedTextControl(typing.cast(Any, title_text)), height=1, dont_extend_width=True))
        
        remaining = total_cols - title_len - 1 # -1 for the corner
        for i in range(remaining):
            top_elements.append(Window(width=1, height=1, char=Border.HORIZONTAL, 
                                     style=partial(self._get_diag_style, 0, title_len + i, total_rows, total_cols)))
        
        top_elements.append(Window(width=1, height=1, char="╮", 
                                 style=partial(self._get_diag_style, 0, total_cols - 1, total_rows, total_cols)))

        # Bottom row
        bottom_elements: list[AnyContainer] = []
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
        pass
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
        total_vram_bytes = 0
        found = False
        for path in glob.glob("/sys/class/drm/card*/device/mem_info_vram_total"):
            with open(path, 'r') as f:
                total_vram_bytes += int(f.read())
            found = True
        if found:
            return total_vram_bytes / (1024 * 1024 * 1024)
    except Exception:
        pass

    return 0.0

def get_disk_free_gb(path: str) -> float:
    """Get free disk space in GB for the given path."""
    try:
        if not os.path.exists(path):
            os.makedirs(path, exist_ok=True)
        _, _, free = shutil.disk_usage(path)
        return free / (1024 * 1024 * 1024)
    except Exception:
        pass
    return 10.0 # Fallback

SYSTEM_RAM_GB = get_system_ram_gb()
SYSTEM_VRAM_GB = get_vram_gb()
TOTAL_MEM_GB = SYSTEM_RAM_GB + SYSTEM_VRAM_GB
DISK_FREE_GB = get_disk_free_gb(str(LLAMA_MODELS_DIR))

def can_run_model(size_bytes: Optional[int]) -> tuple[bool, str]:
    """Check if model can run based on size vs RAM/Disk."""
    if size_bytes is None:
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
    _cache: dict[str, list[dict[str, Any]]] = {} # Global cache for precaching: {sort_mode: [models]}
    _is_precaching: bool = False

    def __init__(self) -> None:
        self.api = HfApi()
        
    def list_gguf_models(self, 
                        sort: str = "downloads", 
                        limit: int = 50, 
                        search: Optional[str] = None,
                        author: Optional[str] = None) -> list[dict[str, Any]]:
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

        params: dict[str, Any] = {
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
            results: list[dict[str, Any]] = []
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
                    "id": getattr(m, 'id', "Unknown"),
                    "downloads": getattr(m, 'downloads', 0) or 0,
                    "likes": getattr(m, 'likes', 0) or 0,
                    "last_modified": getattr(m, 'lastModified', None),
                    "author": getattr(m, 'author', "Unknown") or "Unknown",
                })
            
            # Update cache for standard requests
            if not search and not author:
                self._cache[sort] = results
                
            return results
        except Exception:
            return []

    @classmethod
    def precache_background(cls) -> None:
        """Start a background thread to fetch all tab data."""
        if cls._is_precaching:
            return
        cls._is_precaching = True
        
        import threading
        def _task() -> None:
            manager = HFModelManager()
            # Precache all tabs
            for sort in ["Downloads", "Trending", "Updated"]:
                manager.list_gguf_models(sort=sort)
            cls._is_precaching = False
            
        threading.Thread(target=_task, daemon=True).start()

    def get_model_files(self, model_id: str) -> list[dict[str, Any]]:
        """Get GGUF files for a specific model."""
        try:
            # Use list_repo_tree with recursive=True to find all .gguf files
            files_info = [f for f in self.api.list_repo_tree(model_id, recursive=True) 
                         if f.path.endswith(".gguf")]
            
            results: list[dict[str, Any]] = []
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
            
        except Exception:
            return []


# --- TUI Implementation ---

class DownloadUI:
    def __init__(self) -> None:
        self.manager = HFModelManager()
        self.models_data: list[dict[str, Any]] = []
        self.selected_model_id: Optional[str] = None
        self.files_data: list[dict[str, Any]] = []
        self.is_dimmed = False
        self.is_loading = False
        
        # State
        self.current_tab = "Most Downloaded" # Most Downloaded, Top Rated, Newest
        self.current_provider = "TheBloke" 
        self.current_sort = "Downloads" # Controlled by Tab now
        self.search_query = ""
        self.active_view = "model_list" # model_list, quant_list, download_progress, download_success, download_error
        self.download_task: Optional[asyncio.Task[None]] = None
        self.download_status = "Idle"
        self.download_error: Optional[str] = None
        self.downloaded_path: Optional[str] = None
        self.download_bytes = 0
        self.download_total_bytes = 0
        self.download_speed_bytes = 0.0
        self.download_started_at: Optional[float] = None
        self.active_download_file: Optional[dict[str, Any]] = None
        
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
            'completion-menu': 'noinherit',
            'completion-menu.completion': 'noinherit',
            'completion-menu.completion.current': 'noinherit reverse',
            'completion-menu.meta': 'noinherit',
            'completion-menu.meta.completion': 'noinherit',
            'completion-menu.meta.completion.current': 'noinherit reverse',
            'scrollbar.background': 'noinherit',
            'scrollbar.button': 'noinherit',
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
        self._search_task: Optional[asyncio.Task[None]] = None
        
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
        
        # File List
        self.file_list_control = FormattedTextControl(
            text=self._get_file_list_text,
            focusable=True,
            show_cursor=False,
            key_bindings=self._get_file_list_key_bindings(),
            get_cursor_position=self._get_file_list_cursor_position
        )
        self.file_list_window = Window(
            content=self.file_list_control,
            height=12
        )
        self.selected_file_index = 0
        self.file_list_scroll_offset = 0

        self.download_status_control = FormattedTextControl(
            text=self._get_download_status_text,
            focusable=True,
            show_cursor=False,
            key_bindings=self._get_download_key_bindings(),
        )
        self.download_status_window = Window(
            content=self.download_status_control,
            height=12
        )
        self._refresh_task: Optional[asyncio.Task[None]] = None
        self._style_cache: dict[tuple[int, bool], list[str]] = {} # Cache for gradient styles
        
        # Layout construction
        
        # Main content inside the frame
        self.body_container = DynamicContainer(self._get_active_body)

        main_content = HSplit([
            # Top Row: Tabs | Spacer | Info
            VSplit([
                # Use a narrower container for tabs to allow the spacer to work
                Window(content=FormattedTextControl(self._get_tabs_text), height=1, dont_extend_width=True),
                Window(), # Flexible spacer
                Window(
                    FormattedTextControl(f"RAM+VRAM: {TOTAL_MEM_GB:.1f}GB | Disk: {DISK_FREE_GB:.1f}GB "), 
                    style="class:status", 
                    align=WindowAlign.RIGHT, 
                    dont_extend_width=True
                ),
            ], height=1),
            
            # Separator
            Window(height=1, char=" "),
            
            # The List
            self.body_container,
            
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
        self.floats: list[Float] = [
            Float(xcursor=True,
                  ycursor=True,
                  content=MultiColumnCompletionsMenu(suggested_max_column_width=20))
        ]
        self.main_layout_container = FloatContainer(
            content=self.root_container,
            floats=self.floats
        )
        
        self.layout = Layout(self.main_layout_container, focused_element=self.model_list_control)
        
        self.kb = KeyBindings()
        self._setup_global_bindings()
        
        self.app: Application[Any] = Application(
            layout=self.layout,
            key_bindings=self.kb,
            style=self.style,
            full_screen=False,
            mouse_support=True,
            color_depth=ColorDepth.TRUE_COLOR,
            before_render=self._on_render
        )

    def _on_render(self, _app: Application[Any]) -> None:
        """Start background tasks on first render."""
        if not hasattr(self, '_task_started'):
            setattr(self, '_task_started', True)
            self.app.create_background_task(self._initial_load())

    def _get_active_body(self) -> AnyContainer:
        if self.active_view == "model_list":
            return self.model_list_window
        if self.active_view == "quant_list":
            return self.file_list_window
        return self.download_status_window

    def _get_model_list_cursor_position(self) -> Optional[Point]:
        if self.is_loading or not self.models_data:
            return None
        visible_count = max(min(len(self.models_data) - self.list_scroll_offset, 10), 1)
        row = self.selected_model_index - self.list_scroll_offset + 2
        return Point(x=0, y=min(max(row, 2), visible_count + 1))

    def _get_file_list_cursor_position(self) -> Optional[Point]:
        if not self.files_data:
            return None
        visible_count = max(min(len(self.files_data) - self.file_list_scroll_offset, 9), 1)
        row = self.selected_file_index - self.file_list_scroll_offset + 3
        return Point(x=0, y=min(max(row, 3), visible_count + 2))

    def _get_tabs_text(self) -> list[tuple[str, str]]:
        tabs = ["Most Downloaded", "Top Rated", "Newest"]
        result: list[tuple[str, str]] = []
        
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
        return result

    def _get_status_text(self) -> str:
        if self.active_view == "model_list":
            return " [Tab] Focus  [Enter] Select  [←/→] Sort By  [Esc] Quit"
        if self.active_view == "quant_list":
            return " [Enter] Download  [Esc] Back"
        if self.download_task and not self.download_task.done():
            return " Downloading... please wait"
        if self.active_view == "download_success":
            return " [Esc] Back  [Enter] Back to quants"
        if self.active_view == "download_error":
            return " [Esc] Back  [Enter] Retry"
        return " [Esc] Back"

    def _truncate(self, value: str, width: int) -> str:
        if width <= 0:
            return ""
        if len(value) <= width:
            return value
        if width <= 3:
            return value[:width]
        return value[:width - 3] + "..."

    def _format_bytes(self, size: float) -> str:
        units = ["B", "KB", "MB", "GB", "TB"]
        unit_idx = 0
        size_val = float(size)
        while size_val >= 1024 and unit_idx < len(units) - 1:
            size_val /= 1024
            unit_idx += 1
        if unit_idx == 0:
            return f"{int(size_val)} {units[unit_idx]}"
        return f"{size_val:.1f} {units[unit_idx]}"

    def _fit_status(self, file_info: dict[str, Any]) -> tuple[str, str]:
        if file_info.get("can_run"):
            return "OK", "fg:ansigreen"

        reason = str(file_info.get("reason", "")).lower()
        if "disk" in reason:
            return "DISK", "fg:ansired"
        if "large" in reason or "memory" in reason:
            return "MEM", "fg:ansired"
        return "NO", "fg:ansired"

    def _selected_line_fragments(
        self,
        text: str,
        is_focused: bool,
        suffix: Optional[tuple[str, str]] = None,
    ) -> list[tuple[str, str]]:
        fragments: list[tuple[str, str]] = []
        line_len = len(text)
        cache_key = (line_len, is_focused)
        if cache_key not in self._style_cache:
            styles: list[str] = []
            for col in range(line_len):
                if col == 0 and is_focused:
                    styles.append("bg:#ffccff #000000")
                else:
                    progress = col / max(line_len - 1, 1)
                    r, g, b = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, progress)
                    styles.append(f"bg:#{r:02x}{g:02x}{b:02x} #000000")
            self._style_cache[cache_key] = styles

        for idx, char in enumerate(text):
            fragments.append((self._style_cache[cache_key][idx], char))

        if suffix:
            suffix_text, suffix_style = suffix
            for char in suffix_text:
                fragments.append((suffix_style, char))

        fragments.append(("", "\n"))
        return fragments

    def _get_model_table_line(self, model: dict[str, Any], is_selected: bool, is_focused: bool) -> list[tuple[str, str]]:
        name_width = 52
        downloads_width = 10
        updated_width = 10

        name = self._truncate(str(model.get("id", "Unknown")), name_width)
        downloads_val = model.get('downloads', 0)
        downloads = f"{downloads_val/1000:.1f}k" if downloads_val > 1000 else str(downloads_val)

        last_mod = "Unknown"
        if model.get('last_modified'):
            m_date = model['last_modified']
            if isinstance(m_date, datetime):
                last_mod = m_date.strftime('%Y-%m-%d')
            else:
                last_mod = str(m_date)[:10]

        cursor = ">" if is_selected else " "
        text = f"{cursor} {name:<{name_width}}  {downloads:>{downloads_width}}  {last_mod:>{updated_width}}"
        if not is_selected:
            return [("", text + "\n")]
        if self.is_dimmed:
            return [("bg:#555555 #000000", text + "\n")]
        return self._selected_line_fragments(text, is_focused)

    def _get_model_list_text(self) -> Union[StyleAndTextTuples, str]:
        if self.is_loading:
            return [("", " ⏳ Loading models from Hugging Face...")]

        if not self.models_data:
            return "No models found."
            
        lines: list[Any] = []
        height = 12
        start = self.list_scroll_offset
        end = start + max(height - 2, 1)
        
        visible_items = self.models_data[start:end]
        is_focused = self.layout.has_focus(self.model_list_control)

        lines.append(("class:header", " Model                                                Downloads     Updated\n"))
        lines.append(("class:status", " " + "─" * 76 + "\n"))
        
        for i, model in enumerate(visible_items):
            real_idx = start + i
            lines.extend(self._get_model_table_line(model, real_idx == self.selected_model_index, is_focused))
            
        return to_formatted_text(lines)

    def _get_file_list_text(self) -> Union[StyleAndTextTuples, str]:
        if not self.files_data:
            return "No compatible files found."
            
        lines: list[Any] = []
        title = self.selected_model_id or "Unknown"
        lines.append(("class:header", f" {self._truncate(title, 72)}\n"))
        lines.append(("class:status", " Filename                                   Quant              Size      Fit\n"))
        lines.append(("class:status", " " + "─" * 76 + "\n"))
        is_focused = self.layout.has_focus(self.file_list_control)
        height = 12
        start = self.file_list_scroll_offset
        end = start + max(height - 3, 1)
        
        for i, f in enumerate(self.files_data[start:end]):
            real_idx = start + i
            is_selected = (real_idx == self.selected_file_index)
            size_val = f.get('size') or 0
            size_gb = size_val / (1024*1024*1024)
            fname = str(f.get('filename', 'Unknown'))
            if "/" in fname:
                fname = fname.split("/")[-1]
            quant = self._truncate(str(f.get('quant', 'Unknown')), 16)
            fit_text, fit_style = self._fit_status(f)
            cursor = ">" if is_selected else " "
            text = f"{cursor} {self._truncate(fname, 40):<40}  {quant:<16}  {size_gb:>5.1f} GB  "
            if is_selected:
                if self.is_dimmed:
                    lines.append(("bg:#555555 #000000", text + fit_text + "\n"))
                else:
                    lines.extend(self._selected_line_fragments(text, is_focused, (fit_text, fit_style)))
            else:
                lines.append(("", text))
                lines.append((fit_style, f"{fit_text}\n"))
            
        return to_formatted_text(lines)

    def _render_progress_bar(self, width: int = 48) -> StyleAndTextTuples:
        filled = 0
        if self.download_total_bytes > 0:
            filled = int(width * min(self.download_bytes / self.download_total_bytes, 1.0))
        fragments: StyleAndTextTuples = [("class:status", " ")]
        for idx in range(width):
            if idx < filled:
                progress = idx / max(width - 1, 1)
                r, g, b = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, progress)
                fragments.append((f"bg:#{r:02x}{g:02x}{b:02x} #000000", " "))
            else:
                fragments.append(("bg:#222222", " "))
        fragments.append(("", " "))
        percent = 0.0
        if self.download_total_bytes > 0:
            percent = (self.download_bytes / self.download_total_bytes) * 100
        fragments.append(("class:header", f"{percent:5.1f}%"))
        return fragments

    def _get_download_status_text(self) -> StyleAndTextTuples:
        model_id = self.selected_model_id or "Unknown model"
        file_name = "Unknown file"
        if self.active_download_file:
            file_name = str(self.active_download_file.get("filename", "Unknown"))
            if "/" in file_name:
                file_name = file_name.split("/")[-1]

        elapsed = 0.0
        if self.download_started_at is not None:
            elapsed = max(time.time() - self.download_started_at, 0.0)

        info_lines = [
            ("class:header", f" {self.download_status}\n"),
            ("", f" Model: {self._truncate(model_id, 68)}\n"),
            ("", f" File:  {self._truncate(file_name, 68)}\n"),
            ("", "\n"),
        ]

        fragments: StyleAndTextTuples = []
        fragments.extend(info_lines)
        fragments.extend(self._render_progress_bar())
        fragments.append(("", "\n\n"))

        total_text = self._format_bytes(self.download_total_bytes) if self.download_total_bytes > 0 else "Unknown"
        fragments.append(("", f" Downloaded: {self._format_bytes(self.download_bytes)} / {total_text}\n"))
        fragments.append(("", f" Speed:      {self._format_bytes(self.download_speed_bytes)}/s\n"))
        fragments.append(("", f" Elapsed:    {elapsed:.1f}s\n"))
        if self.downloaded_path:
            display_path = self.downloaded_path
            if str(Path.home()) in display_path:
                display_path = display_path.replace(str(Path.home()), "~")
            fragments.append(("", f" Path:       {self._truncate(display_path, 68)}\n"))
        else:
            fragments.append(("", f" Path:       {self._truncate(str(LLAMA_MODELS_DIR / (self.selected_model_id or '')), 68)}\n"))

        if self.active_view == "download_success":
            fragments.append(("fg:ansigreen", "\n Download complete.\n"))
            fragments.append(("", f" Use with: /model {model_id}/{file_name}\n"))
        elif self.active_view == "download_error":
            fragments.append(("class:error", "\n Download failed.\n"))
            if self.download_error:
                fragments.append(("class:error", f" {self._truncate(self.download_error, 72)}\n"))

        return fragments

    def _setup_global_bindings(self) -> None:
        @self.kb.add("escape")
        def _(event: KeyPressEvent) -> None:
            if self.active_view == "quant_list":
                self._return_to_model_list()
                event.app.invalidate()
                return

            if self.active_view in {"download_progress", "download_success", "download_error"}:
                if self.download_task and not self.download_task.done():
                    return
                self._return_to_quant_list()
                event.app.invalidate()
                return

            # Apply dimmed style for "greyed out" look on exit
            self.is_dimmed = True
            
            # Type safe access to containers
            root_container = typing.cast(Any, self.layout.container)
            
            # Find the CustomFrame(s) and dim them
            if hasattr(root_container, 'get_children'):
                for container in root_container.get_children():
                    if isinstance(container, CustomFrame):
                        container.is_dimmed = True
            
            # If the layout is currently showing a popup, it's a FloatContainer
            if isinstance(root_container, FloatContainer):
                for f in root_container.floats:
                    if isinstance(f.content, CustomFrame):
                        f.content.is_dimmed = True
                # Also dim the base content
                if isinstance(root_container.content, CustomFrame):
                    root_container.content.is_dimmed = True

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
        def _(event: KeyPressEvent) -> None:
            if self.active_view != "model_list":
                return
            if self.app.layout.has_focus(self.search_area):
                self.app.layout.focus(self.model_list_control)
            else:
                self.app.layout.focus(self.search_area)

    def _get_list_key_bindings(self) -> KeyBindings:
        kb = KeyBindings()
        
        @kb.add("left")
        def _(event: KeyPressEvent) -> None:
            # Cycle tabs left
            tabs = ["Most Downloaded", "Top Rated", "Newest"]
            curr_idx = tabs.index(self.current_tab)
            self.current_tab = tabs[(curr_idx - 1) % len(tabs)]
            self.refresh_data()
            event.app.invalidate()

        @kb.add("right")
        def _(event: KeyPressEvent) -> None:
            # Cycle tabs right
            tabs = ["Most Downloaded", "Top Rated", "Newest"]
            curr_idx = tabs.index(self.current_tab)
            self.current_tab = tabs[(curr_idx + 1) % len(tabs)]
            self.refresh_data()
            event.app.invalidate()
        
        @kb.add("up")
        def _(event: KeyPressEvent) -> None:
            if self.selected_model_index > 0:
                self.selected_model_index -= 1
                # Scroll up if needed
                if self.selected_model_index < self.list_scroll_offset:
                    self.list_scroll_offset = self.selected_model_index
                event.app.invalidate()
                
        @kb.add("down")
        def _(event: KeyPressEvent) -> None:
            if self.selected_model_index < len(self.models_data) - 1:
                self.selected_model_index += 1
                # Scroll down if needed
                height = 12 - 2
                if self.selected_model_index >= self.list_scroll_offset + height:
                    self.list_scroll_offset = self.selected_model_index - height + 1
                event.app.invalidate()

        @kb.add("enter")
        def _(event: KeyPressEvent) -> None:
            if self.models_data:
                mid = str(self.models_data[self.selected_model_index].get('id', ''))
                if mid:
                    self.open_file_selection(mid)
        
        return kb

    def _get_file_list_key_bindings(self) -> KeyBindings:
        kb = KeyBindings()
        
        @kb.add("up")
        def _(event: KeyPressEvent) -> None:
            if self.selected_file_index > 0:
                self.selected_file_index -= 1
                if self.selected_file_index < self.file_list_scroll_offset:
                    self.file_list_scroll_offset = self.selected_file_index
                event.app.invalidate()
            
        @kb.add("down")
        def _(event: KeyPressEvent) -> None:
            if self.selected_file_index < len(self.files_data) - 1:
                self.selected_file_index += 1
                height = 12 - 3
                if self.selected_file_index >= self.file_list_scroll_offset + height:
                    self.file_list_scroll_offset = self.selected_file_index - height + 1
                event.app.invalidate()

        @kb.add("enter")
        def _(event: KeyPressEvent) -> None:
            if self.files_data:
                selected = self.files_data[self.selected_file_index]
                if not selected.get('can_run'):
                    # User asked to "not populate" bad ones,
                    # but we are showing them with a warning status.
                    # We will block selection to be safe.
                    # Just return, do nothing
                    return
                else:
                    self.start_download(selected)
        
        return kb

    def _get_download_key_bindings(self) -> KeyBindings:
        kb = KeyBindings()

        @kb.add("enter")
        def _(event: KeyPressEvent) -> None:
            if self.active_view == "download_success":
                self._return_to_quant_list()
                event.app.invalidate()
                return

            if self.active_view == "download_error" and self.active_download_file:
                self.start_download(self.active_download_file)
                event.app.invalidate()

        return kb

    def _on_text_changed(self, _: Any) -> None:
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

    async def _fetch_models(self, sort_mode: str, query: str) -> None:
        """Execute the API call in background."""
        self.is_loading = True
        try:
            loop = asyncio.get_event_loop()
            results = await loop.run_in_executor(
                None,
                partial(self.manager.list_gguf_models, sort=sort_mode, search=query, limit=100)
            )
            self.models_data = results
            self.selected_model_index = 0
            self.list_scroll_offset = 0
        except Exception:
            self.models_data = []
        finally:
            self.is_loading = False
            self.app.invalidate()

    async def _do_live_search(self) -> None:
        """Async task to debounce and fetch results."""
        try:
            await asyncio.sleep(0.3) # Debounce delay
            
            # Disengage model search if user is typing a slash command
            if self.search_query.lstrip().startswith("/"):
                return

            # Determine sort mode
            sort_mode = "Downloads"
            if self.current_tab == "Top Rated":
                sort_mode = "Trending"
            elif self.current_tab == "Newest":
                sort_mode = "Updated"

            await self._fetch_models(sort_mode, self.search_query)

        except asyncio.CancelledError:
            pass # Task was cancelled by a newer keystroke

    def _on_search(self, buff: Any) -> bool:
        text = self.search_area.text.strip()
        if text.startswith("/"):
            self.app.exit(result=text)
            return False # Don't keep text
            
        # If results are already there from live search, just focus the list
        if self.models_data:
            self.app.layout.focus(self.model_list_control)
        else:
            # Fallback to manual refresh if live search hasn't finished
            self.search_query = self.search_area.text
            self.refresh_data()
            
        return True

    def refresh_data(self) -> None:
        """Trigger a refresh of the data."""
        if self.search_query.lstrip().startswith("/"):
            return

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
            # Call _fetch_models directly without debounce for tab switches/refresh
            self._search_task = self.app.create_background_task(self._fetch_models(sort_mode, self.search_query))
            return

        # Fallback for sync (should typically not be reached in new flow)
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

    def open_file_selection(self, model_id: str) -> None:
        self.selected_model_id = model_id
        self.active_view = "quant_list"
        
        # Fetch files
        files = self.manager.get_model_files(model_id)
        self.files_data = files
        self.selected_file_index = 0
        self.file_list_scroll_offset = 0
        self.app.layout.focus(self.file_list_control)
        self.app.invalidate()

    def _return_to_model_list(self) -> None:
        self.active_view = "model_list"
        self.app.layout.focus(self.model_list_control)

    def _return_to_quant_list(self) -> None:
        self.active_view = "quant_list"
        self.app.layout.focus(self.file_list_control)

    def start_download(self, file_info: dict[str, Any]) -> None:
        self.active_download_file = file_info
        self.download_status = "Preparing download"
        self.download_error = None
        self.downloaded_path = None
        self.download_bytes = 0
        self.download_total_bytes = int(file_info.get("size") or 0)
        self.download_speed_bytes = 0.0
        self.download_started_at = time.time()
        self.active_view = "download_progress"
        self.app.layout.focus(self.download_status_control)
        self.download_task = self.app.create_background_task(self._run_download(file_info))
        self.app.invalidate()

    async def _run_download(self, file_info: dict[str, Any]) -> None:
        loop = asyncio.get_running_loop()
        try:
            await loop.run_in_executor(None, partial(self._download_file_sync, file_info, loop))
            self.download_status = "Download complete"
            self.active_view = "download_success"
        except Exception as e:
            self.download_error = str(e)
            self.download_status = "Download failed"
            self.active_view = "download_error"
        finally:
            self.app.invalidate()

    def _download_file_sync(self, file_info: dict[str, Any], loop: asyncio.AbstractEventLoop) -> None:
        model_id = self.selected_model_id
        if not model_id:
            raise RuntimeError("No model selected")

        filename = str(file_info.get("filename", ""))
        if not filename:
            raise RuntimeError("No file selected")

        target_dir = LLAMA_MODELS_DIR / model_id
        target_path = target_dir / filename
        temp_path = target_path.with_name(target_path.name + ".part")
        target_dir.mkdir(parents=True, exist_ok=True)
        temp_path.parent.mkdir(parents=True, exist_ok=True)

        encoded_filename = "/".join(quote(part) for part in filename.split("/"))
        url = f"https://huggingface.co/{model_id}/resolve/main/{encoded_filename}"

        self.download_status = "Downloading"
        loop.call_soon_threadsafe(self.app.invalidate)

        try:
            request = Request(url, headers={"User-Agent": "yips-cli"})
            with urlopen(request, timeout=30) as response:
                total = int(response.headers.get("content-length", "0"))
                if total > 0:
                    self.download_total_bytes = total
                last_update = time.time()
                last_bytes = 0

                with open(temp_path, "wb") as handle:
                    while True:
                        chunk = response.read(1024 * 256)
                        if not chunk:
                            break
                        handle.write(chunk)
                        self.download_bytes += len(chunk)
                        now = time.time()
                        if now > last_update:
                            self.download_speed_bytes = (self.download_bytes - last_bytes) / max(now - last_update, 0.001)
                            last_update = now
                            last_bytes = self.download_bytes
                        loop.call_soon_threadsafe(self.app.invalidate)

            if target_path.exists():
                target_path.unlink()
            temp_path.replace(target_path)
            self.downloaded_path = str(target_path)
        except Exception:
            if temp_path.exists():
                temp_path.unlink()
            raise

        self.download_status = "Finalizing"
        loop.call_soon_threadsafe(self.app.invalidate)

    async def _initial_load(self) -> None:
        """Initial load task."""
        self.refresh_data()

    def run(self) -> Any:
        # Initial fetch handled via on_startup to be async
        return self.app.run()


def run_download_ui(agent: Optional[Any] = None) -> Optional[Union[str, dict[str, Any]]]:
    """Entry point."""
    ui = DownloadUI()
    if agent is not None:
        with agent.modal_prompt_application(ui.app):
            result = ui.run()
    else:
        result = ui.run()
    
    if isinstance(result, str):
        return result
    return None

if __name__ == "__main__":
    from pathlib import Path # Ensure Path is available in __main__
    run_download_ui()
