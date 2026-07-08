import re

# Read the file
with open('quiz-server/public/slides.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Find all slide divs with their IDs
# Pattern: <div class="slide ... id="slide-XXX"> ... </div> (at same level)
# We need to find each slide block

slides = {}
# Find all slide starts
slide_starts = [(m.group(1), m.start()) for m in re.finditer(r'<div class="slide[^"]*" id="(slide-[^"]+)"', content)]

# Find the end of each slide (start of next slide, or end of file)
for i, (slide_id, start_pos) in enumerate(slide_starts):
    if i + 1 < len(slide_starts):
        end_pos = slide_starts[i + 1][1]
    else:
        end_pos = len(content)
    slides[slide_id] = content[start_pos:end_pos]

print(f"Found {len(slides)} slides")
for sid in sorted(slides.keys()):
    print(f"  {sid}: {len(slides[sid])} chars")

# Now build the new content in correct order
# Correct order (insert qr-N after the corresponding part end):
# slide-1, slide-2, slide-3, slide-4, slide-qr-1,
# slide-5, slide-6, slide-7, slide-8, slide-9, slide-10, slide-11, slide-qr-2,
# slide-12, slide-13, slide-14, slide-15, slide-16, slide-qr-3,
# slide-17, slide-18, slide-19, slide-20, slide-21, slide-qr-4,
# slide-22, slide-23, slide-24, slide-25, slide-26, slide-qr-5,
# slide-27, slide-28, slide-qr-6

correct_order = [
    'slide-1', 'slide-2', 'slide-3', 'slide-4', 'slide-qr-1',
    'slide-5', 'slide-6', 'slide-7', 'slide-8', 'slide-9', 'slide-10', 'slide-11', 'slide-qr-2',
    'slide-12', 'slide-13', 'slide-14', 'slide-15', 'slide-16', 'slide-qr-3',
    'slide-17', 'slide-18', 'slide-19', 'slide-20', 'slide-21', 'slide-qr-4',
    'slide-22', 'slide-23', 'slide-24', 'slide-25', 'slide-26', 'slide-qr-5',
    'slide-27', 'slide-28', 'slide-qr-6',
]

# Build new content: take everything before first slide, then slides in order, then everything after last slide
first_slide_start = slide_starts[0][1]
new_content = content[:first_slide_start]
for sid in correct_order:
    if sid in slides:
        new_content += slides[sid]
    else:
        print(f"WARNING: {sid} not found!")

# Write back
with open('quiz-server/public/slides.html', 'w', encoding='utf-8') as f:
    f.write(new_content)

print("Done! Slides reordered.")
print(f"New file size: {len(new_content)} chars")
