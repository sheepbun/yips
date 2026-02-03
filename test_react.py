
import sys
import os
from pathlib import Path

# Add project root to sys.path
sys.path.append(str(Path(__file__).parent))

from cli.agent import YipsAgent
from cli.main import process_response_and_tools
from cli.color_utils import console

def test_loop():
    agent = YipsAgent()
    agent.initialize_backend()
    
    # Simulate a user message that should trigger a multi-step task
    # For testing, we can mock the model response or just use a real one if backend is running.
    # Since I'm in an environment where I can't easily run LM Studio, 
    # I'll rely on the existing code structure.
    
    print("Agent initialized. Ready to test loop logic.")

if __name__ == "__main__":
    test_loop()
