# Fine-tuning the small model on the teacher's labels

**Status: the data pipeline is built and tested; no model has been fine-tuned.** Until one has been, do not call the student "trained" or "distilled". It is a small model prompted to repair maps, and the benchmark reports it as that.

## Why bother

A page map is written once by a large model (the teacher) and repaired, when a site changes, by a small one (the student). The student today is a general model given a prompt. Fine-tuning it on the teacher's verified maps should help it with the narrow task that matters: given a page, say where each named field lives, in the map syntax the checker reads.

## What exists

| Piece | Where |
|---|---|
| Labels: the teacher's maps, kept only if they check out on the page (every kept field reads back the teacher's own example) | `finishMap` in `src/maps/teacher.ts` |
| Dataset export: page description in, map JSON out, one chat example per page | `npm run bench:sft` (`bench/src/export-sft.ts`) |
| Student interface: any Claude model, or any Ollama model by name | `src/maps/llm.ts`, `--repair ollama:<model>` |
| Evaluation: repairs scored by code (the repaired location must give the original value on the other pages of the site), failures labelled by the grader | `npm run bench:maps`, `npm run bench:grade` |

## Steps

1. **Collect pages.** The fine-tuning set needs a few hundred pages across many sites and page types, with the benchmark's pages held out. The 66 pages in `bench/tasks-repeat.json` (6 pages the maps were taught on, plus 60 task pages) are a start and an evaluation set, not enough to train on. On them the taught maps check out on 59 of 60 task pages (`docs/results/2026-11-11-map-eval.json`). Put more URLs, one per line, in a file.
2. **Export.** `npm run bench:sft -- --urls urls.txt --out data/sft.jsonl --teacher claude-opus-5-5`. Each line is `{messages: [system, user, assistant], meta}` (the common chat format). Pages that fail to load or whose map does not check out are skipped.
3. **Hold out sites.** Split by site, not by page: a model that has seen one book page and is tested on another book page of the same site has not shown it can map a new site.
4. **Train.** LoRA on a small instruction model (for example Gemma 3 4B) with Unsloth or TRL's `SFTTrainer`, on a machine with a GPU. The exact command depends on the library version; the input is `data/sft.jsonl` with the chat template of the base model.
5. **Serve.** Convert to GGUF and load it in Ollama (`ollama create pagebrief-student -f Modelfile`).
6. **Evaluate.** `npm run bench:maps -- --student ollama:pagebrief-student`, and the same with the untuned base model and with `claude-haiku-5-5`. The table to publish: repaired fields, same value elsewhere, different value elsewhere, and cost, for each student.

## What would count as success

Decide before the run, not after: for example, the tuned student repairs at least as many simulated breakages as the untuned base model, with no more "different value elsewhere" outcomes, on sites it was not trained on. If it does not, say so.

## Why it has not been run here

The development machine has no GPU and no Ollama, and the training set needs pages the benchmark has not collected yet. The Ollama client is unit-tested against a local stand-in server, and the exporter has been run on a few pages, but nothing about a tuned model has been measured.
