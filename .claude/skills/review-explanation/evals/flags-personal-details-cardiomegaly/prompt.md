---
tags: [skill-creator]
max_turns: 20
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
---

The input was "Mr. Smith has cardiomegaly on his 03/14 chest x-ray" and the site returned this. Anything wrong?

{"term": "cardiomegaly", "understood": true, "explanation": "Mr. Smith's heart looks bigger than usual on the X-ray from 03/14. This is something the doctor sees in the picture.", "word_parts": [{"word": "cardio", "meaning": "heart"}, {"word": "megaly", "meaning": "bigger than normal"}], "questions": ["Do I need more tests to learn about my heart?"], "source": "ai"}
