import os

input_file = "indian_law_knowledge.txt"
output_dir = "legal_chunks"
os.makedirs(output_dir, exist_ok=True)

with open(input_file, "r", encoding="utf-8") as f:
    content = f.read()

entries = content.strip().split("\n\n")
print(f"Total entries: {len(entries)}")

chunk_size = 10000
chunks = [entries[i:i+chunk_size] for i in range(0, len(entries), chunk_size)]

for i, chunk in enumerate(chunks):
    out_path = f"{output_dir}/law_part_{i+1}.txt"
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("\n\n".join(chunk))
    print(f"Saved law_part_{i+1}.txt ({len(chunk)} entries)")

print(f"\nDone! {len(chunks)} files saved in '{output_dir}' folder")