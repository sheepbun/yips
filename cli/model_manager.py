"""
Interactive TUI for managing local and remote models in Yips.
"""

import os
import asyncio
from typing import List, Dict, Optional, Tuple, Any, Callable, TypedDict
from pathlib import Path

from prompt_toolkit import Application
from prompt_toolkit.output.color_depth import ColorDepth
from prompt_toolkit.key_binding import KeyBindings, KeyPressEvent
from prompt_toolkit.styles import Style
from prompt_toolkit.layout.containers import (
    HSplit,
    VSplit,
    Window,
    FloatContainer,
    DynamicContainer,
    WindowAlign,
    AnyContainer,
)
from prompt_toolkit.layout.controls import FormattedTextControl
from prompt_toolkit.buffer import Buffer
from prompt_toolkit.data_structures import Point
from prompt_toolkit.layout.layout import Layout
from prompt_toolkit.widgets import (
    Box,
    TextArea,
)
from prompt_toolkit.widgets.base import Border
from prompt_toolkit.formatted_text.utils import fragment_list_to_text
from prompt_toolkit.formatted_text import AnyFormattedText, StyleAndTextTuples, to_formatted_text
from functools import partial

from cli.color_utils import (
    console,
    interpolate_color,
    GRADIENT_PINK,
    GRADIENT_YELLOW,
    GRADIENT_BLUE,
)
from cli.llamacpp import LLAMA_MODELS_DIR, get_available_models
from cli.hw_utils import get_system_specs, is_model_suitable
from cli.info_utils import get_friendly_model_name, set_model_nickname
from cli.completer import SlashCommandCompleter
import shlex

class ModelData(TypedDict):
    id: str
    name: str
    friendly_name: str
    host: str
    backend: str
    friendly_backend: str
    size_gb: float
    suitability: Optional[str]
    path: Optional[Path]

class CustomFrame:
    def __init__(
        self,
        body: AnyContainer,
        title: AnyFormattedText = "",
        style: str = "",
        width: Optional[int] = None,
        height: Optional[int] = None,
    ) -> None:
        self.title = title
        self.body = body
        self.is_dimmed = False
        self.parent_is_dimmed: Optional[Callable[[], bool]] = None
        self.container = DynamicContainer(self._get_container)

    def _get_diag_style(self, row_idx: int, col_idx: int, total_rows: int, total_cols: int) -> str:
        progress = col_idx / max(total_cols - 1, 1)
        r, g, b = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, progress)
        return f"#{r:02x}{g:02x}{b:02x}"

    def _get_container(self) -> HSplit:
        total_rows = 15 
        total_cols = console.width or 80

        title_text: StyleAndTextTuples = []
        prefix = "╭─── "
        for i, char in enumerate(prefix):
            style = self._get_diag_style(0, i, total_rows, total_cols)
            title_text.append((style, char))
        
        # Normalize title to string for checking "Yips"
        formatted_title = to_formatted_text(self.title)
        full_title = fragment_list_to_text(formatted_title)
        
        if "Yips" in full_title:
            parts = full_title.split("Yips", 1)
            yips_str = "Yips"
            for i, char in enumerate(yips_str):
                progress = i / max(len(yips_str) - 1, 1)
                r, g, b = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, progress)
                style = f"#{r:02x}{g:02x}{b:02x}"
                title_text.append((style, char))
            
            rest = parts[1]
            if rest:
                title_text.append((self._get_diag_style(0, len(title_text), total_rows, total_cols), " "))
                blue_hex = f"#{GRADIENT_BLUE[0]:02x}{GRADIENT_BLUE[1]:02x}{GRADIENT_BLUE[2]:02x}"
                # Keep "Model Manager" colored (not dimmed) to match Downloader
                rest_display = rest.strip()
                for char in rest_display:
                    title_text.append((blue_hex, char))
        else:
            for i, char in enumerate(full_title):
                style = self._get_diag_style(0, len(prefix) + i, total_rows, total_cols)
                title_text.append((style, char))

        title_len = len(title_text)
        title_text.append((self._get_diag_style(0, title_len, total_rows, total_cols), " "))
        title_len += 1

        top_elements: List[AnyContainer] = []
        top_elements.append(Window(content=FormattedTextControl(title_text), height=1, dont_extend_width=True))
        
        remaining = total_cols - title_len - 1 
        for i in range(remaining):
            top_elements.append(Window(width=1, height=1, char=Border.HORIZONTAL, 
                                     style=partial(self._get_diag_style, 0, title_len + i, total_rows, total_cols)))
        
        top_elements.append(Window(width=1, height=1, char="╮", 
                                 style=partial(self._get_diag_style, 0, total_cols - 1, total_rows, total_cols)))

        bottom_elements: List[AnyContainer] = []
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

class ModelManagerUI:
    def __init__(self, current_model: str, current_backend: str):
        self.current_model = current_model
        self.current_backend = current_backend
        self.models_data: List[ModelData] = []
        self.is_dimmed = False
        self.specs = get_system_specs()
        self.current_tab = "Local" # Local or Cloud
        
        self.style = Style.from_dict({
            "frame.border": "#5f00ff", 
            "frame.label": "bold #ffff00",
            "header": "#5f00ff bold",
            "tab.active": "bg:#5f00ff #ffffff bold", 
            "tab.inactive": "#888888",
            "list-item.selected": "bg:#5f00ff #ffffff",
            "status": "#888888",
            "error": "#ff0000",
            "input": "#ffccff",
            "search_prompt": "#ffccff",
        })

        self.search_area = TextArea(
            multiline=False, 
            prompt=[("class:search_prompt", ">>> 🔍 ")],
            style="class:input",
            completer=SlashCommandCompleter(),
            accept_handler=self._on_search
        )
        
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
        self.selected_index = 0
        self.scroll_offset = 0
        
        # Scroll states for columns
        self.host_scroll_offset: float = 0
        self.host_scroll_direction = 1
        
        self.friendly_scroll_offset: float = 0
        self.friendly_scroll_direction = 1
        
        self.name_scroll_offset: float = 0
        self.name_scroll_direction = 1
        
        self._scroll_delay_active = True
        self._style_cache: Dict[Tuple[int, bool], List[str]] = {} # Cache for gradient styles: (length, is_focused) -> [styles]
        
        self.is_loading = True
        
        main_content = HSplit([
            VSplit([
                Window(content=FormattedTextControl(self._get_header_text), height=1),
                Window(),
                Window(
                    FormattedTextControl(f"RAM: {self.specs['ram_gb']}GB | VRAM: {self.specs['vram_gb']}GB "), 
                    style="class:status", 
                    align=WindowAlign.RIGHT, 
                    dont_extend_width=True
                ),
            ], height=1),
            Window(height=1, char=" "),
            self.model_list_window,
            Window(FormattedTextControl(self._get_status_text), height=1, style="class:status"),
        ])
        
        self.frame = CustomFrame(
            main_content,
            title="Yips Model Manager"
        )
        # Link the frame's dimmed check to this UI's state
        self.frame.parent_is_dimmed = lambda: self.is_dimmed
        
        self.root_container = FloatContainer(
            content=HSplit([
                self.frame.container,
                Box(self.search_area, padding=0),
            ]),
            floats=[]
        )
        
        self.layout = Layout(self.root_container, focused_element=self.model_list_control)
        
        self.kb = KeyBindings()
        @self.kb.add("escape")
        def _(event: KeyPressEvent) -> None:
            # Apply dimmed style for "greyed out" look on exit
            self.is_dimmed = True
            
            dim_style = Style.from_dict({
                "frame.border": "#444444", 
                "frame.label": "#555555",
                "header": "#555555",
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
            if self.layout.has_focus(self.search_area):
                self.layout.focus(self.model_list_control)
            else:
                self.layout.focus(self.search_area)

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
        """Start background tasks on the first render when the loop is running."""
        if not hasattr(self, '_task_started'):
            self._task_started = True
            self.app.create_background_task(self._scroll_animation_task())
            self.app.create_background_task(self._fetch_models_task())

    async def _scroll_animation_task(self) -> None:
        """Task to animate scrolling for long text in columns when selected and focused."""
        while True:
            await asyncio.sleep(0.15)
            if not self.app.is_running:
                break
                
            if not self.models_data:
                continue

            # Only scroll if the model list is focused
            if not self.layout.has_focus(self.model_list_control):
                needs_reset = False
                if any([self.host_scroll_offset != 0, self.friendly_scroll_offset != 0, self.name_scroll_offset != 0]):
                    needs_reset = True
                
                self.host_scroll_offset = 0
                self.host_scroll_direction = 1
                self.friendly_scroll_offset = 0
                self.friendly_scroll_direction = 1
                self.name_scroll_offset = 0
                self.name_scroll_direction = 1
                
                if needs_reset:
                    self.app.invalidate()
                self._scroll_delay_active = True
                continue

            if self._scroll_delay_active:
                await asyncio.sleep(1.0) # Initial wait
                self._scroll_delay_active = False

            model = self.models_data[self.selected_index]
            needs_invalidate = False
            
            # 1. Host Column (Width 18)
            host = model['host'].strip()
            if len(host) > 18:
                limit = len(host) - 18
                if self.host_scroll_direction == 1 and self.host_scroll_offset >= limit:
                    self.host_scroll_offset = float(limit)
                    self.host_scroll_direction = -1
                    needs_invalidate = True
                    # We don't sleep here to keep columns somewhat in sync or moving
                elif self.host_scroll_direction == -1 and self.host_scroll_offset <= 0:
                    self.host_scroll_offset = 0
                    self.host_scroll_direction = 1
                    needs_invalidate = True
                else:
                    self.host_scroll_offset += self.host_scroll_direction
                    needs_invalidate = True
            else:
                if self.host_scroll_offset != 0:
                    self.host_scroll_offset = 0
                    needs_invalidate = True

            # 2. Friendly Name Column (Width 15)
            f_name = model['friendly_name'].strip()
            if len(f_name) > 15:
                limit = len(f_name) - 15
                if self.friendly_scroll_direction == 1 and self.friendly_scroll_offset >= limit:
                    self.friendly_scroll_offset = float(limit)
                    self.friendly_scroll_direction = -1
                    needs_invalidate = True
                elif self.friendly_scroll_direction == -1 and self.friendly_scroll_offset <= 0:
                    self.friendly_scroll_offset = 0
                    self.friendly_scroll_direction = 1
                    needs_invalidate = True
                else:
                    self.friendly_scroll_offset += self.friendly_scroll_direction
                    needs_invalidate = True
            else:
                if self.friendly_scroll_offset != 0:
                    self.friendly_scroll_offset = 0
                    needs_invalidate = True

            # 3. Formal Name Column (Width available_name_width)
            name = model['name'].strip()
            avail_width = self.available_name_width
            if len(name) > avail_width:
                limit = len(name) - avail_width
                if self.name_scroll_direction == 1 and self.name_scroll_offset >= limit:
                    self.name_scroll_offset = float(limit)
                    self.name_scroll_direction = -1
                    needs_invalidate = True
                elif self.name_scroll_direction == -1 and self.name_scroll_offset <= 0:
                    self.name_scroll_offset = 0
                    self.name_scroll_direction = 1
                    needs_invalidate = True
                else:
                    self.name_scroll_offset += self.name_scroll_direction
                    needs_invalidate = True
            else:
                if self.name_scroll_offset != 0:
                    self.name_scroll_offset = 0
                    needs_invalidate = True

            if needs_invalidate:
                self.app.invalidate()

    def _get_models_data(self) -> List[ModelData]:
        """Synchronous helper to gather model data."""
        models: List[ModelData] = []
        
        if self.current_tab == "Cloud":
            # Claude Models
            for m in ["haiku", "sonnet", "opus"]:
                models.append({
                    "id": m,
                    "name": m,
                    "friendly_name": get_friendly_model_name(m),
                    "host": "Anthropic",
                    "backend": "claude",
                    "friendly_backend": "Claude",
                    "size_gb": 0.0,
                    "suitability": "vram", # Claude always works (cloud)
                    "path": None
                })
        else:
            # Local Models
            local_models = get_available_models()
            for m_path in local_models:
                full_path = LLAMA_MODELS_DIR / m_path
                size_gb = 0.0
                if full_path.exists():
                    size_gb = full_path.stat().st_size / (1024**3)
                
                suitability = is_model_suitable(self.specs, size_gb)
                
                # Extract host (first part of the relative path if it's a directory structure)
                host = "Local"
                parts = Path(m_path).parts
                if len(parts) > 1:
                    host = parts[0]

                # Use filename without extension for 'name'
                display_filename = os.path.basename(m_path)
                if display_filename.endswith(".gguf"):
                    display_filename = display_filename[:-5]

                models.append({
                    "id": m_path,
                    "name": display_filename,
                    "friendly_name": get_friendly_model_name(m_path),
                    "host": host,
                    "backend": "llamacpp",
                    "friendly_backend": "llama.cpp",
                    "size_gb": size_gb,
                    "suitability": suitability,
                    "path": full_path
                })
        return models

    async def _fetch_models_task(self) -> None:
        """Async task to refresh models."""
        self.is_loading = True
        self.app.invalidate()
        
        try:
            loop = asyncio.get_event_loop()
            self.models_data = await loop.run_in_executor(None, self._get_models_data)
            
            # Initial selection should be the current model if found (only on first load or if matching)
            # Or always try to find current model if we switched tabs?
            # Let's try to maintain selection if possible, or select current model
            found = False
            for i, m in enumerate(self.models_data):
                if m['id'] == self.current_model and m['backend'] == self.current_backend:
                    self.selected_index = i
                    if self.selected_index >= 12:
                        self.scroll_offset = self.selected_index - 11
                    found = True
                    break
            
            if not found:
                self.selected_index = 0
                self.scroll_offset = 0

        except Exception:
            self.models_data = []
        finally:
            self.is_loading = False
            self.app.invalidate()

    def refresh_models(self) -> None:
        if hasattr(self, 'app') and self.app.is_running:
            self.app.create_background_task(self._fetch_models_task())
        else:
            # Fallback (mostly for testing or non-running state)
            self.models_data = self._get_models_data()

    def _get_model_list_cursor_position(self) -> Point:
        row = self.selected_index - self.scroll_offset
        return Point(x=0, y=row)

    def _get_header_text(self) -> StyleAndTextTuples:
        tabs = ["Local", "Cloud"]
        result: StyleAndTextTuples = []
        
        for t in tabs:
            display_t = f" {t} "
            if t == self.current_tab:
                if self.is_dimmed:
                    result.append(("bg:#555555 #000000 bold", display_t))
                else:
                    # Map gradient to the tab width for active tab
                    for i, char in enumerate(display_t):
                        progress = i / max(len(display_t) - 1, 1)
                        r, g, b = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, progress)
                        result.append((f"bg:#{r:02x}{g:02x}{b:02x} #000000 bold", char))
            else:
                style = "class:tab.inactive"
                if self.is_dimmed:
                    style = "#444444"
                result.append((style, display_t))
            
            result.append(("", " "))
            
        return result

    def _get_status_text(self) -> str:
        return " [Tab] Focus  [Enter] Select  [Del] Delete Local  [T] Downloader  [Esc] Quit"

    def _get_model_list_text(self) -> StyleAndTextTuples:
        if self.is_loading:
            return [("", " ⏳ Loading models...")]
            
        if not self.models_data:
            return [("", "No models found.")]
            
        lines: StyleAndTextTuples = []
        height = 12
        start = self.scroll_offset
        end = start + height
        is_focused = self.layout.has_focus(self.model_list_control)
        
        visible_items = self.models_data[start:end]
        
        # Calculate available width once per render call
        avail_width = self.available_name_width
        
        for i, model in enumerate(visible_items):
            real_idx = start + i
            is_selected = (real_idx == self.selected_index)
            is_current = (model['id'] == self.current_model and model['backend'] == self.current_backend)
            
            # Host
            host_name = model['host'].strip()
            if is_selected and len(host_name) > 18:
                off = int(self.host_scroll_offset)
                host_display = host_name[off : off + 18]
                host_col = f" {host_display:<18} |"
            elif len(host_name) > 18:
                host_col = f" {host_name[:18]} |"
            else:
                host_col = f" {host_name:<18} |"
            
            # Backend
            backend = model['friendly_backend']
            backend_col = f" {backend:<10} |"
            
            # Friendly Name
            friendly_name = model['friendly_name'].strip()
            if is_selected and len(friendly_name) > 15:
                off = int(self.friendly_scroll_offset)
                f_display = friendly_name[off : off + 15]
                friendly_col = f" {f_display:<15} |"
            elif len(friendly_name) > 15:
                friendly_col = f" {friendly_name[:15]} |"
            else:
                friendly_col = f" {friendly_name:<15} |"
            
            # Size + Hardware Info
            suit = model['suitability']
            hw_label = "-"
            if model['backend'] == 'llamacpp':
                if suit == "vram": hw_label = "VRAM"
                elif suit == "ram": hw_label = "RAM"
                elif suit is None: hw_label = "LARGE"
                else: hw_label = "OK"
            elif model['backend'] == 'claude':
                hw_label = "Cloud"
                
            size_gb = model['size_gb']
            size_text = f"{size_gb:.1f} GB" if size_gb > 0 else "-"
            
            if model['backend'] == 'claude':
                # Center "- Cloud" within the 12-character content area
                combined_hw_size = f"{size_text} {hw_label}".center(12)
            else:
                # Right-align the size part to align digits for local models
                size_part = f"{size_text:>7}"
                combined_hw_size = f"{size_part} {hw_label}" if hw_label != "-" else size_part
                # Left-align the combined result within the 12-character content area
                combined_hw_size = f"{combined_hw_size:<12}"
            
            hw_size_col = f" {combined_hw_size} |"
            
            current_marker = "*" if is_current else " "
            cursor = ">" if is_selected else " "
            prefix = f"{cursor}{current_marker}"
            
            # Use pre-calculated avail_width
            name = model['name'].strip()
            
            if is_selected and len(name) > avail_width:
                start_scroll = int(self.name_scroll_offset)
                content = name[start_scroll : start_scroll + avail_width]
                display_name = f" {content.ljust(avail_width)} "
            elif len(name) > avail_width:
                display_name = f" {name[:avail_width-3]}... "
                display_name = display_name.ljust(avail_width + 2)
            else:
                display_name = f" {name.ljust(avail_width)} "
            
            text = prefix + host_col + backend_col + friendly_col + hw_size_col + display_name
            
            if is_selected:
                if self.is_dimmed:
                    lines.append(("bg:#555555 #000000", text + "\n"))
                else:
                    line_len = len(text)
                    cache_key = (line_len, is_focused)
                    if cache_key not in self._style_cache:
                        styles: List[str] = []
                        for col in range(line_len):
                            if col == 0 and is_focused:
                                styles.append("bg:#ffccff #000000")
                            else:
                                progress = col / max(line_len - 1, 1)
                                r, g, b = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, progress)
                                styles.append(f"bg:#{r:02x}{g:02x}{b:02x} #000000")
                        self._style_cache[cache_key] = styles
                    
                    cached_styles = self._style_cache[cache_key]
                    for col, char in enumerate(text):
                        lines.append((cached_styles[col], char))
                    lines.append(("", "\n"))
            else:
                style = ""
                if is_current: 
                    style = "fg:#89cff0"
                    if self.is_dimmed:
                        style = "fg:#555555"
                lines.append((style, text + "\n"))
            
        return lines

    def _get_list_key_bindings(self) -> KeyBindings:
        kb = KeyBindings()
        
        @kb.add("left")
        def _(event: KeyPressEvent) -> None:
            # Toggle tabs
            self.current_tab = "Local" if self.current_tab == "Cloud" else "Cloud"
            self.selected_index = 0
            self.scroll_offset = 0
            self._scroll_delay_active = True
            self.refresh_models()
            event.app.invalidate()

        @kb.add("right")
        def _(event: KeyPressEvent) -> None:
            # Toggle tabs
            self.current_tab = "Cloud" if self.current_tab == "Local" else "Local"
            self.selected_index = 0
            self.scroll_offset = 0
            self._scroll_delay_active = True
            self.refresh_models()
            event.app.invalidate()

        @kb.add("up")
        def _(event: KeyPressEvent) -> None:
            if self.selected_index > 0:
                self.selected_index -= 1
                self.host_scroll_offset = 0
                self.host_scroll_direction = 1
                self.friendly_scroll_offset = 0
                self.friendly_scroll_direction = 1
                self.name_scroll_offset = 0
                self.name_scroll_direction = 1
                self._scroll_delay_active = True
                if self.selected_index < self.scroll_offset:
                    self.scroll_offset = self.selected_index
                event.app.invalidate()
                
        @kb.add("down")
        def _(event: KeyPressEvent) -> None:
            if self.selected_index < len(self.models_data) - 1:
                self.selected_index += 1
                self.host_scroll_offset = 0
                self.host_scroll_direction = 1
                self.friendly_scroll_offset = 0
                self.friendly_scroll_direction = 1
                self.name_scroll_offset = 0
                self.name_scroll_direction = 1
                self._scroll_delay_active = True
                if self.selected_index >= self.scroll_offset + 12:
                    self.scroll_offset = self.selected_index - 11
                event.app.invalidate()

        @kb.add("enter")
        def _(event: KeyPressEvent) -> None:
            if self.models_data:
                model = self.models_data[self.selected_index]
                event.app.exit(result=f"/model {model['id']}")

        @kb.add("delete")
        def _(event: KeyPressEvent) -> None:
            if not self.models_data:
                return
            model = self.models_data[self.selected_index]
            if model['backend'] == 'llamacpp' and model['path']:
                # For simplicity in this TUI, we'll just delete it if 'd' is pressed.
                # In a more robust version, we'd add a confirmation popup.
                try:
                    if model['path'].exists():
                        model['path'].unlink()
                        # Also try to remove parent dir if empty (for HF style downloads)
                        parent = model['path'].parent
                        if parent != LLAMA_MODELS_DIR and parent.exists() and not any(parent.iterdir()):
                            parent.rmdir()
                        
                        self.refresh_models()
                        self.selected_index = min(self.selected_index, len(self.models_data) - 1)
                except Exception:
                    pass

        @kb.add("t")
        def _(event: KeyPressEvent) -> None:
            event.app.exit(result="/download")
        
        return kb

    def _on_search(self, buff: Buffer) -> bool:
        # Handle /nick command internally to refresh UI without closing
        text = self.search_area.text.strip()
        if text.startswith("/nick"):
            try:
                parts = shlex.split(text)
                if len(parts) >= 3:
                    # /nick <target> <new_nick>
                    set_model_nickname(parts[1], parts[2])
                    self.refresh_models()
                    self.search_area.text = ""
                    return True
            except Exception:
                pass
                
        if text.startswith("/"):
            self.app.exit(result=text)
            return False
        return True

    def run(self) -> str | bool | None:
        return self.app.run()

    @property
    def available_name_width(self) -> int:
        """Calculate width available for the formal model name content."""
        total_width = console.width or 80
        # Usable space inside frame: total_width - 2
        # Marker: 2
        # Host: 1 (space) + 18 (content) + 1 (space) + 1 (|) = 21
        # Backend: 1 (space) + 10 (content) + 1 (space) + 1 (|) = 13
        # Friendly Name: 1 (space) + 15 (content) + 1 (space) + 1 (|) = 18
        # Size + HW Label: 1 (space) + 12 (content) + 1 (space) + 1 (|) = 15
        # Internal Padding for Formal Name: 2 (1 space on each side)
        # Total overhead: 2 (frame) + 2 (marker) + 21 + 13 + 18 + 15 + 2 = 71
        return max(1, total_width - 71)

def run_model_manager_ui(current_model: str, current_backend: str) -> str | bool | None:
    ui = ModelManagerUI(current_model, current_backend)
    return ui.run()