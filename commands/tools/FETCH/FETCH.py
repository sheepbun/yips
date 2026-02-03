#!/usr/bin/env python3
"""
FETCH - Web content fetcher for Yips.

Fetches a URL and returns the text content (stripped of HTML).
"""

import sys
import requests
from bs4 import BeautifulSoup

def fetch_url(url):
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
        response = requests.get(url, headers=headers, timeout=15)
        response.raise_for_status()
        
        soup = BeautifulSoup(response.text, 'html.parser')
        
        # Remove script and style elements
        for script_or_style in soup(["script", "style"]):
            script_or_style.decompose()

        # Get text
        text = soup.get_text()

        # Break into lines and remove leading and trailing whitespace
        lines = (line.strip() for line in text.splitlines())
        # Break multi-headlines into a line each
        chunks = (phrase.strip() for line in lines for phrase in line.split("  "))
        # Drop blank lines
        text = '\n'.join(chunk for chunk in chunks if chunk)

        return text
    except Exception as e:
        return f"Error fetching URL: {e}"

def main():
    if len(sys.argv) < 2:
        print("Usage: /fetch <url>")
        sys.exit(1)
        
    url = sys.argv[1]
    print(f"Fetching {url}...")
    content = fetch_url(url)
    print("-" * 40)
    # Truncate if too long for a single turn
    if len(content) > 10000:
        print(content[:10000])
        print("\n... (truncated)")
    else:
        print(content)

if __name__ == "__main__":
    main()
