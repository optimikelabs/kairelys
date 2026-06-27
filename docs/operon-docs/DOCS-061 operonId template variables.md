---
Up:
  - "[[DOCS-024 Task templates|Task templates]]"
  - "[[DOCS-051 Templater and QuickAdd workflows|Templater and QuickAdd workflows]]"
  - "[[DOCS-015 Task identity and operonId|Task identity and operonId]]"
Notes: Mint ids and fill task, date, status, and priority values inside templates
Icon: braces
Color: "#059669"
tags:
  - operon
  - operonid
  - templates
  - automation
Updated: 2026-06-27T14:05:00
---

# Template variables

When a template builds a task, every task in it needs a real `operonId`, and the template often needs the task's dates, note, or title in more than one place. Operon solves this with `{{...}}` template variables: special tokens you write in a [[DOCS-024 Task templates|template]] that Operon turns into real values when it creates the task.

## Identity variables

There are two `operonId` forms, and the difference is everything:

- **`{{operonId}}`** (no suffix): a **fresh, unique id every time it appears**. Use it wherever a task just needs its own identity.
- **`{{operonId1}}`** (a one-character suffix): a **shared id**. The first time a given suffix appears, Operon mints a new id and remembers it; every later use of that **same** suffix returns the **same** id. Use it when one id must show up in more than one place.

The suffix is exactly one character, a letter or a digit, so `{{operonId1}}`, `{{operonId2}}`, and `{{operonIda}}` are three different shared ids. Reusing a suffix is how you make two lines talk about the same task.

## Task value variables

These variables fill values from the task being created:

| Variable | Value |
| --- | --- |
| `{{date}}` | the local creation date, as `YYYY-MM-DD` |
| `{{datetime}}` | the local creation datetime, as `YYYY-MM-DDTHH:mm:ss` |
| `{{taskDescription}}` | the task's description/title |
| `{{note}}` | the task's `note` field |
| `{{dateStarted}}` | the task's start date, or blank |
| `{{dateScheduled}}` | the task's scheduled date, or blank |
| `{{dateDue}}` | the task's due date, or blank |
| `{{status}}` | the task's final workflow status, such as `Project.Brainstorming` or `Project.Planned` |
| `{{priority}}` | the task's final priority value, such as `High` or `A` |

There are no aliases for these names. If a value is not available, Operon writes an empty value rather than leaving the variable behind.

## Where variables resolve

Operon replaces variables when it generates a task from a template:

- In a file task's **frontmatter**.
- In a file task template's **body text**, outside fenced code blocks.
- In **task lines** in the body.

The nine task value variables can appear in normal template prose, such as a heading or a short context block. `operonId` is stricter: it resolves in frontmatter and task lines, but not in ordinary prose. `{{date}}`, `{{datetime}}`, `{{status}}`, and `{{priority}}` also resolve in raw pasted task lines, so quick inline snippets can stamp today's local date/time and default workflow fields without a full file template. Fenced code blocks keep the literal token text so examples stay copyable.

The ids are shared across the whole file as it is generated, so a suffix used in the frontmatter and the same suffix on a body task line resolve to the **same** id. That shared scope is exactly what lets a child line reference the parent task's id. The date/time variables use one creation timestamp, so `{{date}}` and `{{datetime}}` stay consistent inside the same generated task.

For file task templates, `{{status}}` and `{{priority}}` come from the final task draft. That means Operon first considers the source task, the selected template, inherited values, scheduled-date automation, and your defaults, then writes the value that actually belongs on the new task. For raw pasted inline snippets, there is no file-template context, so `{{status}}` uses the first status in your default pipeline and `{{priority}}` uses your default priority.

## Filling task context in a file template

Use task value variables when the file body should repeat the task's title, note, dates, status, or priority.

Template input:

```md
---
operonId: {{operonId}}
Status: {{status}}
Priority: {{priority}}
dateStarted: {{dateStarted}}
dateScheduled: {{dateScheduled}}
dateDue: {{dateDue}}
datetimeCreated: {{datetime}}
datetimeModified: {{datetime}}
note: {{note}}
---

# {{taskDescription}}

Status: {{status}}
Priority: {{priority}}
Started: {{dateStarted}}
Scheduled: {{dateScheduled}}
Due: {{dateDue}}
Created: {{datetime}}

{{note}}
```

Example output if the task is created on `2026-06-27T13:46:10`, your default status resolves to `Project.Brainstorming`, your default priority is `High`, and the task has scheduled and due dates:

```md
---
operonId: a1b2c3d
Status: Project.Brainstorming
Priority: High
dateStarted:
dateScheduled: 2026-06-28
dateDue: 2026-07-04
datetimeCreated: 2026-06-27T13:46:10
datetimeModified: 2026-06-27T13:46:10
note: Confirm owner before kickoff
---

# Prepare launch task

Status: Project.Brainstorming
Priority: High
Started:
Scheduled: 2026-06-28
Due: 2026-07-04
Created: 2026-06-27T13:46:10

Confirm owner before kickoff
```

Your real output will use your pipeline, your priority labels, and the current local time. If the task has no start date, scheduled date, due date, or note, those variables become blank. This keeps template output clean and avoids treating a literal variable as a real date.

## Pasted inline snippets

Raw pasted inline snippets support the variables that do not need file-template context:

- `{{operonId}}` and suffixed ids such as `{{operonId1}}`.
- `{{date}}` and `{{datetime}}`, from the current local creation time.
- `{{status}}`, from the first status in your default pipeline.
- `{{priority}}`, from your default priority.

Paste this:

```md
- [ ] Follow up with reviewer {{operonId:: {{operonId}}}} {{status:: {{status}}}} {{priority:: {{priority}}}} {{dateScheduled:: {{date}}}} {{datetimeCreated:: {{datetime}}}} {{datetimeModified:: {{datetime}}}}
```

With default status `Project.Brainstorming`, default priority `High`, and current local time `2026-06-27T13:46:10`, Operon writes:

```md
- [ ] Follow up with reviewer {{operonId:: a1b2c3d}} {{status:: Project.Brainstorming}} {{priority:: High}} {{dateScheduled:: 2026-06-27}} {{datetimeCreated:: 2026-06-27T13:46:10}} {{datetimeModified:: 2026-06-27T13:46:10}}
```

For parent-child snippets, use a suffixed id on the parent and reuse it in each child's `parentTask`:

```md
- [ ] Parent variable test {{operonId:: {{operonId1}}}} {{status:: {{status}}}} {{priority:: {{priority}}}} {{dateScheduled:: {{date}}}} {{datetimeCreated:: {{datetime}}}} {{datetimeModified:: {{datetime}}}}
    - [ ] Child one variable test {{operonId:: {{operonId}}}} {{parentTask:: {{operonId1}}}} {{status:: {{status}}}} {{priority:: {{priority}}}} {{dateDue:: {{date}}}} {{datetimeCreated:: {{datetime}}}} {{datetimeModified:: {{datetime}}}}
```

Example output:

```md
- [ ] Parent variable test {{operonId:: a1b2c3d}} {{status:: Project.Brainstorming}} {{priority:: High}} {{dateScheduled:: 2026-06-27}} {{datetimeCreated:: 2026-06-27T13:46:10}} {{datetimeModified:: 2026-06-27T13:46:10}}
    - [ ] Child one variable test {{operonId:: e4f5g6h}} {{parentTask:: a1b2c3d}} {{status:: Project.Brainstorming}} {{priority:: High}} {{dateDue:: 2026-06-27}} {{datetimeCreated:: 2026-06-27T13:46:10}} {{datetimeModified:: 2026-06-27T13:46:10}}
```

Raw paste does not fill variables that need a file-template task context: `{{note}}`, `{{taskDescription}}`, `{{dateStarted}}`, `{{dateScheduled}}`, and `{{dateDue}}`. You can still use fields such as `{{dateScheduled:: {{date}}}}`, because the inner `{{date}}` is one of the raw-paste variables.

## Wiring a parent and its subtasks

Give the parent a suffixed id, then reference that same suffix in each child's `parentTask`. Here a file task is the parent, and its body holds two inline subtasks:

```md
---
operonId: {{operonId1}}
Status: Project.Planned
---

- [ ] First subtask {{operonId:: {{operonId}}}} {{parentTask:: {{operonId1}}}}
- [ ] Second subtask {{operonId:: {{operonId}}}} {{parentTask:: {{operonId1}}}}
```

When Operon generates this:

- The parent's `operonId` becomes a real id, call it `aaa1111`, because of `{{operonId1}}`.
- Each subtask's own `{{operonId}}` becomes its **own** fresh id.
- Each subtask's `{{parentTask:: {{operonId1}}}}` resolves to `aaa1111`, the parent, so both children are linked to it. See [[DOCS-016 Parent and sub-tasks|Parent and sub-tasks]].

For deeper trees, use another suffix per level. A middle task takes `{{operonId2}}` as its own id, and its grandchildren point their `parentTask` at `{{operonId2}}`:

```md
- [ ] Middle task {{operonId:: {{operonId2}}}} {{parentTask:: {{operonId1}}}}
- [ ] Leaf task {{operonId:: {{operonId}}}} {{parentTask:: {{operonId2}}}}
```

## With Templater and QuickAdd

Variables combine with [Templater](https://github.com/SilentVoid13/Templater) syntax in the same template, so one template can fill dates and prompts and also mint ids, wire parents, and repeat the final Operon status and priority. The division of labour is clean: QuickAdd decides where and when a note is created, Templater can fill its own dynamic content, and Operon ensures the task fields and ids are right. See [[DOCS-051 Templater and QuickAdd workflows|Templater and QuickAdd workflows]].

## Before you build: check your key mappings

A template writes property names directly, so they must match what Operon reads. Before authoring templates, open **Settings → Operon → Core → Keymapping** and confirm your field names, so a template's frontmatter and inline fields line up with your mappings. See [[DOCS-039 Key mappings|Key mappings]].

## FAQ

**Why didn't a `{{operonId}}` in my note resolve?** `operonId` variables resolve only in frontmatter and on task lines, never in prose or inside fenced code blocks.

**Can I use `{{taskDescription}}` in a heading?** Yes. Task value variables resolve in file task template body text, so headings, context sections, and task lines can reuse the same task values.

**Can I paste `{{date}}`, `{{status}}`, or `{{priority}}` into an inline task?** Yes. `{{date}}` and `{{datetime}}` resolve in pasted task lines using the current local time. `{{status}}` resolves to the first status in your default pipeline, and `{{priority}}` resolves to your default priority. The other task value variables need file template context, so `{{note}}`, `{{taskDescription}}`, `{{dateStarted}}`, `{{dateScheduled}}`, and `{{dateDue}}` are not filled during raw paste.

**How do I link a child to its parent in a template?** Give the parent a suffixed id like `{{operonId1}}`, then write the same `{{operonId1}}` in each child's `parentTask`.

**How many shared ids can I use?** As many as you have single-character suffixes, so plenty for any hierarchy you would build by hand.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
