# SEARCH Skill

Search the web using DuckDuckGo. This skill provides live information from the internet.

## Usage
- **User**: Type `/search <query>` in the terminal.
- **Agent**: Use `{INVOKE_SKILL:SEARCH:query}` to fetch information.

## Capabilities
- Provides snippets from top search results.
- Falls back to DuckDuckGo Instant Answer API if advanced scraping is unavailable.
- Useful for checking current events, dates, and facts not in the model's training data.
