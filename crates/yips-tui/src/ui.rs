use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Color, Style};
use ratatui::text::Line;
use ratatui::widgets::{Block, Borders, Paragraph, Wrap};
use ratatui::Frame;

use crate::state::{AppState, HistoryItem};

/// Compute visible conversation lines based on a terminal area.
pub fn history_viewport_lines(area: Rect) -> usize {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(1),
            Constraint::Min(5),
            Constraint::Length(5),
        ])
        .split(area);
    chunks[1].height.saturating_sub(2) as usize
}

/// Draw the complete TUI frame.
pub fn draw(frame: &mut Frame<'_>, state: &AppState) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(1),
            Constraint::Min(5),
            Constraint::Length(5),
        ])
        .split(frame.area());

    draw_status(frame, chunks[0], state);
    draw_history(frame, chunks[1], state);
    draw_input(frame, chunks[2], state);

    let (line, col) = state.cursor_line_col();
    let max_x = chunks[2]
        .x
        .saturating_add(chunks[2].width.saturating_sub(2));
    let max_y = chunks[2]
        .y
        .saturating_add(chunks[2].height.saturating_sub(2));
    let cursor_x = chunks[2].x.saturating_add(1).saturating_add(col).min(max_x);
    let cursor_y = chunks[2]
        .y
        .saturating_add(1)
        .saturating_add(line)
        .min(max_y);
    frame.set_cursor_position((cursor_x, cursor_y));
}

fn draw_status(frame: &mut Frame<'_>, area: Rect, state: &AppState) {
    let session = state.session_id.as_deref().unwrap_or("new");
    let rounds = state
        .last_round_count
        .map(|v| v.to_string())
        .unwrap_or_else(|| "-".to_string());
    let status = if state.awaiting_turn {
        "running"
    } else {
        "idle"
    };

    let mut line = format!("session={} rounds={} state={}", session, rounds, status);
    if state.history_scroll_offset_lines() > 0 {
        line.push_str(&format!(
            " | view=scroll(+{})",
            state.history_scroll_offset_lines()
        ));
    }
    if let Some(err) = &state.error_banner {
        line.push_str(" | error: ");
        line.push_str(err);
    }

    let para = Paragraph::new(line).style(Style::default().fg(Color::Yellow));
    frame.render_widget(para, area);
}

fn draw_history(frame: &mut Frame<'_>, area: Rect, state: &AppState) {
    let mut lines: Vec<Line<'_>> = state
        .history
        .iter()
        .map(history_item_to_line)
        .collect::<Vec<_>>();

    if state.awaiting_turn && !state.streaming_buffer.is_empty() {
        lines.push(Line::raw(format!("Assistant> {}", state.streaming_buffer)));
    }

    let visible = area.height.saturating_sub(2) as usize;
    let total_lines = lines.len();
    let max_offset = total_lines.saturating_sub(visible);
    let offset_from_bottom = state.history_scroll_offset_lines().min(max_offset);
    let end = total_lines.saturating_sub(offset_from_bottom);
    let start = end.saturating_sub(visible);
    let shown: Vec<Line<'_>> = lines.into_iter().skip(start).take(end - start).collect();

    let history = Paragraph::new(shown)
        .block(Block::default().borders(Borders::ALL).title("Conversation"))
        .wrap(Wrap { trim: false });

    frame.render_widget(history, area);
}

fn draw_input(frame: &mut Frame<'_>, area: Rect, state: &AppState) {
    let title =
        "Input (Up/Down/PgUp/PgDn scroll, Enter send, Ctrl+Enter newline, Esc cancel, Ctrl+C quit)";
    let input = Paragraph::new(state.composer.as_str())
        .block(Block::default().borders(Borders::ALL).title(title))
        .wrap(Wrap { trim: false });

    frame.render_widget(input, area);
}

fn history_item_to_line(item: &HistoryItem) -> Line<'_> {
    match item {
        HistoryItem::User { content } => Line::raw(format!("You> {}", content)),
        HistoryItem::Assistant { content } => Line::raw(format!("Assistant> {}", content)),
        HistoryItem::ToolStart {
            tool_call_id,
            tool_name,
        } => Line::styled(
            format!("[tool:start] {} ({})", tool_name, tool_call_id),
            Style::default().fg(Color::Cyan),
        ),
        HistoryItem::ToolResult {
            tool_call_id,
            success,
            output,
        } => {
            let status = if *success { "ok" } else { "failed" };
            let color = if *success { Color::Green } else { Color::Red };
            Line::styled(
                format!("[tool:result] {} {}: {}", tool_call_id, status, output),
                Style::default().fg(color),
            )
        }
        HistoryItem::Error { message } => Line::styled(
            format!("[error] {}", message),
            Style::default().fg(Color::Red),
        ),
        HistoryItem::System { message } => Line::styled(
            format!("[system] {}", message),
            Style::default().fg(Color::Gray),
        ),
    }
}
