from datasets import load_dataset
import json

print("Downloading 169Pi/indian_law dataset...")
dataset = load_dataset("169Pi/indian_law", split="train")

print(f"Total entries: {len(dataset)}")

# Convert to text format for upload into Niglen
with open("indian_law_knowledge.txt", "w", encoding="utf-8") as f:
    for i, item in enumerate(dataset):
        f.write(f"Q: {item['prompt']}\n")
        f.write(f"A: {item['response']}\n\n")
        if i % 1000 == 0:
            print(f"Processed {i}/{len(dataset)}...")

print("Done! Saved as indian_law_knowledge.txt")