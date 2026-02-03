#!/usr/bin/env python3
"""
SEARCH - Web search for Yips.

Uses DuckDuckGo to search the web for information.
"""

import sys
from duckduckgo_search import DDGS

def search_ddg(query):
    try:
        results = []
        with DDGS() as ddgs:
            for r in ddgs.text(query, max_results=5):
                results.append(f"Title: {r['title']}\nURL: {r['href']}\nSnippet: {r['body']}\n")
        
        if not results:
            return "No results found."
        
        return "\n".join(results)
    except Exception as e:
        return f"Error during search: {e}"

def main():
    if len(sys.argv) < 2:
        print("Usage: /search <query>")
        sys.exit(1)
        
    query = " ".join(sys.argv[1:])
    print(f"Searching for: {query}...")
    results = search_ddg(query)
    print("-" * 40)
    print(results)

if __name__ == "__main__":
    main()

