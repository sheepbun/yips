import os
import sys
import shutil
import subprocess
import time
from pathlib import Path
from rich.console import Console
from rich.panel import Panel
from rich.progress import Progress, SpinnerColumn, TextColumn, BarColumn, DownloadColumn, TransferSpeedColumn
from rich.prompt import Confirm

console = Console()

REPO = "sheepbun/yips"
TAG = "v0.1.44"

def get_appdata_path():
    if os.name == "nt":
        return Path(os.environ.get("APPDATA", "")) / ".yips"
    return Path.home() / ".yips"

def update_path(bin_dir):
    """Update system PATH to include the bin directory with a more robust method for Windows."""
    if os.name == "nt":
        try:
            # Use PowerShell to update the User Path directly via the Registry
            # This is generally more reliable than setx which has a 1024 char limit
            bin_dir_str = str(bin_dir)
            ps_cmd = f'[Environment]::SetEnvironmentVariable("Path", [Environment]::GetEnvironmentVariable("Path", "User") + ";{bin_dir_str}", "User")'
            
            # Check if it's already there first to avoid duplicates
            check_ps = f'if ([Environment]::GetEnvironmentVariable("Path", "User") -like "*{bin_dir_str}*") {{ exit 0 }} else {{ exit 1 }}'
            
            check_res = subprocess.run(["powershell", "-Command", check_ps])
            if check_res.returncode == 0:
                return False # Already in path
                
            subprocess.run(["powershell", "-Command", ps_cmd], capture_output=True)
            return True
        except Exception:
            # Fallback to setx if PowerShell fails
            try:
                user_path = os.environ.get("PATH", "")
                if str(bin_dir).lower() not in user_path.lower():
                    subprocess.run(["setx", "PATH", f"{user_path};{bin_dir}"], capture_output=True)
                    return True
            except Exception:
                pass
    else:
        # Unix PATH update (unchanged logic but cleaner)
        shell_rc = None
        shell = os.environ.get("SHELL", "")
        if "zsh" in shell:
            shell_rc = Path.home() / ".zshrc"
        elif "bash" in shell:
            shell_rc = Path.home() / ".bashrc"

        if shell_rc and shell_rc.exists():
            content = shell_rc.read_text()
            if str(bin_dir) not in content:
                with shell_rc.open("a") as f:
                    f.write(f'\n# Yips CLI\nexport PATH="$PATH:{bin_dir}"\n')
                return True
    return False

def main():
    console.print(Panel.fit("[bold cyan]Yips - Installation Wizard[/bold cyan]", border_style="cyan"))
    
    appdata = get_appdata_path()
    bin_dir = appdata / "bin"
    
    console.print(f"This wizard will install Yips to [green]{appdata}[/green].")
    
    if not Confirm.ask("Do you want to continue?"):
        console.print("[yellow]Installation cancelled.[/yellow]")
        sys.exit(0)

    # 1. Create directories
    with console.status("[bold blue]Setting up directory structure...") as status:
        bin_dir.mkdir(parents=True, exist_ok=True)
        time.sleep(1)
        console.print("[green]✓[/green] Directories created.")

    # 2. Download Core Binary
    binary_name = "yips-core-windows.exe" if os.name == "nt" else "yips-core-linux"
    target_name = "yips.exe" if os.name == "nt" else "yips"
    target_path = bin_dir / target_name
    
    download_url = f"https://github.com/{REPO}/releases/download/{TAG}/{binary_name}"
    
    console.print(f"[bold blue]Downloading Yips core binary...")
    
    try:
        import requests
        response = requests.get(download_url, stream=True)
        total_size = int(response.headers.get('content-length', 0))
        
        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            BarColumn(),
            DownloadColumn(),
            TransferSpeedColumn(),
        ) as progress:
            task = progress.add_task(f"Downloading {binary_name}", total=total_size)
            
            with open(target_path, "wb") as f:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)
                    progress.update(task, advance=len(chunk))
        
        if os.name != "nt":
            target_path.chmod(0o755)
            
        console.print("[green]✓[/green] Core binary downloaded.")
    except Exception as e:
        console.print(f"[red]Error downloading binary: {e}[/red]")
        console.print("[yellow]Please check your internet connection and try again.[/yellow]")
        sys.exit(1)

    # 3. Update PATH
    with console.status("[bold blue]Updating system PATH...") as status:
        updated = update_path(bin_dir)
        time.sleep(1)
        if updated:
            console.print("[green]✓[/green] System PATH updated.")
        else:
            console.print("[dim]System PATH already up to date.[/dim]")

    console.print("\n" + Panel.fit(
        "[bold green]Installation Successful![/bold green]\n\n"
        "You can now run [cyan]yips[/cyan] from any terminal.\n"
        "(You may need to restart your terminal for changes to take effect.)",
        border_style="green"
    ))

if __name__ == "__main__":
    main()
