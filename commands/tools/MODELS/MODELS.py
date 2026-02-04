#!/usr/bin/env python3
import sys
import requests
import json
import os
from pathlib import Path
from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from cli.hw_utils import get_system_specs, is_model_suitable

console = Console()

# Hugging Face Search Config
HF_API_URL = "https://huggingface.co/api/models"
# We'll look for popular GGUF models
SEARCH_PARAMS = {
    "search": "GGUF",
    "sort": "downloads",
    "direction": "-1",
    "limit": 20,
    "filter": "gguf"
}

MODELS_DIR = Path.home() / ".lmstudio" / "models"

def fetch_popular_models():
    try:
        response = requests.get(HF_API_URL, params=SEARCH_PARAMS, timeout=10)
        response.raise_for_status()
        return response.json()
    except Exception as e:
        console.print(f"[red]Error fetching from Hugging Face: {e}[/red]")
        return []

def download_model(repo_id):
    # This is a simplified downloader for the demo/implementation
    # In a real scenario, we'd use huggingface_hub or manual requests for the specific GGUF file
    console.print(f"[cyan]To download {repo_id}, we recommend using the Hugging Face CLI or LM Studio.[/cyan]")
    console.print(f"[dim]Command: huggingface-cli download {repo_id} --include \"*.gguf\" --local-dir {MODELS_DIR}[/dim]")

def main():
    specs = get_system_specs()
    console.print(f"[bold]Detected Specs:[/bold] RAM: {specs['ram_gb']}GB | VRAM: {specs['vram_gb']}GB ({specs['gpu_type'] or 'No GPU'})")
    
    models = fetch_popular_models()
    
    table = Table(title="Popular Hugging Face Models (GGUF)")
    table.add_column("Model ID", style="cyan")
    table.add_column("Downloads", style="magenta")
    table.add_column("Suitability", style="green")
    
    for m in models:
        repo_id = m.get("id")
        downloads = m.get("downloads", 0)
        
        # Estimate size (very rough heuristic based on name or metadata)
        # Most popular are 7B-12B, roughly 5-10GB
        est_size_gb = 8 
        if "7b" in repo_id.lower(): est_size_gb = 5
        elif "3b" in repo_id.lower(): est_size_gb = 2
        elif "70b" in repo_id.lower(): est_size_gb = 40
        
        suitable = is_model_suitable(specs, est_size_gb)
        suit_text = "[green]Excellent (VRAM)[/green]" if suitable == "vram" else ("[yellow]Good (RAM)[/yellow]" if suitable == "ram" else "[red]Too Large[/red]")
        
        table.add_row(repo_id, f"{downloads:,}", suit_text)
        
    console.print(table)
    console.print("\n[dim]Use LM Studio or huggingface-cli to download these into ~/.lmstudio/models[/dim]")

if __name__ == "__main__":
    main()
