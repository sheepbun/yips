"""Gateway configuration: token storage, agent settings, masking."""
import re
from cli.config import load_config, save_config

PLATFORMS = ("whatsapp", "telegram", "discord")
GATEWAY_AGENTS = ("llamacpp", "claude", "claude-code", "codex")

def clean_token(token: str | None) -> str:
    """Aggressively strip invisible characters and bracketed paste artifacts from tokens."""
    if not token:
        return ""
    # Remove bracketed paste escape sequences explicitly
    t = token.replace("\x1b[200~", "").replace("\x1b[201~", "")
    # Remove all whitespace, newlines, and non-printable ascii
    t = re.sub(r'[\s\x00-\x1f\x7f-\x9f]', '', t)
    # Remove surrounding quotes
    return t.strip("\"'")

def mask_token(token: str | None) -> str:
    """Display a masked version of a bot token."""
    t = clean_token(token)
    if not t:
        return "<not set>"
    if len(t) <= 6:
        return "*" * len(t)
    return f"{t[:3]}{'*' * (len(t) - 6)}{t[-3:]}"


# Platform token helpers
def get_platform_token(platform: str) -> str:
    config = load_config()
    raw_token = config.get(f"{platform}_token", "")
    return clean_token(raw_token)


def set_platform_token(platform: str, token: str) -> None:
    config = load_config()
    config[f"{platform}_token"] = clean_token(token)
    save_config(config)


def remove_platform_token(platform: str) -> None:
    config = load_config()
    config.pop(f"{platform}_token", None)  # type: ignore[misc]
    save_config(config)


# Agent helpers
def get_gateway_agent() -> str:
    return load_config().get("gateway_agent", "llamacpp")  # type: ignore[return-value]


def set_gateway_agent(agent: str) -> None:
    config = load_config()
    config["gateway_agent"] = agent  # type: ignore[literal-required]
    save_config(config)


def get_agent_bin_path(agent: str) -> str:
    return load_config().get(f"{agent}_bin_path", "")  # type: ignore[return-value]


def set_agent_bin_path(agent: str, path: str) -> None:
    config = load_config()
    config[f"{agent}_bin_path"] = path.strip()  # type: ignore[literal-required]
    save_config(config)


def get_agent_api_key(agent: str) -> str:
    return load_config().get(f"{agent}_api_key", "")  # type: ignore[return-value]


def set_agent_api_key(agent: str, key: str) -> None:
    config = load_config()
    config[f"{agent}_api_key"] = key.strip()  # type: ignore[literal-required]
    save_config(config)


# Discord allowlist helpers
def get_discord_allowed_servers() -> list[str]:
    return load_config().get("discord_allowed_servers", [])  # type: ignore[return-value]


def set_discord_allowed_servers(ids: list[str]) -> None:
    config = load_config()
    config["discord_allowed_servers"] = ids  # type: ignore[literal-required]
    save_config(config)


def get_discord_allowed_channels() -> list[str]:
    return load_config().get("discord_allowed_channels", [])  # type: ignore[return-value]


def set_discord_allowed_channels(ids: list[str]) -> None:
    config = load_config()
    config["discord_allowed_channels"] = ids  # type: ignore[literal-required]
    save_config(config)


def get_discord_allowed_users() -> list[str]:
    return load_config().get("discord_allowed_users", [])  # type: ignore[return-value]


def set_discord_allowed_users(ids: list[str]) -> None:
    config = load_config()
    config["discord_allowed_users"] = ids  # type: ignore[literal-required]
    save_config(config)


# Discord edit-allowed users helpers
def get_discord_edit_allowed_users() -> list[str]:
    return load_config().get("discord_edit_allowed_users", [])  # type: ignore[return-value]


def set_discord_edit_allowed_users(ids: list[str]) -> None:
    config = load_config()
    config["discord_edit_allowed_users"] = ids  # type: ignore[literal-required]
    save_config(config)


def is_edit_allowed(user_id: str) -> bool:
    """Check if a Discord user ID has file-edit permission. Empty list = nobody."""
    allowed = get_discord_edit_allowed_users()
    return user_id in allowed
