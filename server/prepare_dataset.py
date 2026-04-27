import json

input_file = "indian_law_knowledge.txt"
output_file = "legal_finetune.jsonl"

with open(input_file, "r", encoding="utf-8") as f:
    content = f.read()

entries = content.strip().split("\n\n")
count = 0

with open(output_file, "w", encoding="utf-8") as out:
    for entry in entries:
        lines = entry.strip().split("\n")
        if len(lines) >= 2:
            prompt = lines[0].replace("Q: ", "").strip()
            response = "\n".join(lines[1:]).replace("A: ", "").strip()
            if prompt and response:
                json.dump({
                    "instruction": prompt,
                    "input": "",
                    "output": response
                }, out)
                out.write("\n")
                count += 1

print(f"Done! {count} entries saved to {output_file}")