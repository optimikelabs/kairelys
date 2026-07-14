---
Up:
  - "[[DOCS-109 Table presets|Table presets]]"
  - "[[DOCS-105 Table overview|Table overview]]"
  - "[[DOCS-044 Where Operon stores data|Where Operon stores data]]"
Notes: How a saved table lives as its own portable .table file in your vault
Icon: file-cog
Color: "#0284c7"
tags:
  - operon
  - table
  - presets
  - files
  - configure
Updated: 2026-07-14T00:13:46
---

# Table files

A [[DOCS-109 Table presets|Table preset]] is not only a setting tucked away in Operon's data. Each one is also a real file in your vault, with a `.table` extension. That file is the preset: open it, and Operon shows the same table you would get from the toolbar's preset picker. Move it, rename it, back it up, or put it under version control, and you are doing exactly what you would do with any other note. This page covers the file itself, its lifecycle, and what happens when something about it goes wrong. For what a preset holds and how you edit it day to day, see [[DOCS-109 Table presets|Table presets]].

> **MEDIA-DOCS-114-1:** A `.table` file in Obsidian's file explorer, opened as a standard Operon Table view with its normal header.

![MEDIA-DOCS-114-1 - A Table file opened as a standard Operon Table view](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-114-1.png)

## What a Table file is

A `.table` file is plain JSON with a small envelope around your preset: a `format` marker, a version number, and then the same preset data covered in [[DOCS-109 Table presets|Table presets]], its id, name, filter, columns, grouping, sorting, summaries, display density, and saved search scope. Nothing about what a preset can hold changes because it now lives in a file; this page is about the file as a vault object, not the settings inside it.

Because the format is versioned and validated, Operon is strict about what it accepts. A file with a missing field, an unexpected field, the wrong `format` or `version` value, or JSON that does not parse at all is never guessed at or partially loaded. It is treated as invalid, and Operon tells you exactly why (see "When a file cannot be read" below) rather than silently accepting something broken.

## Where Table files live

New Table files are created in an **Operon/Tables** folder at the root of your vault. This happens automatically whenever Operon needs to create one:

- **New** or **Duplicate** from a preset's settings.
- A **related view** created from a Calendar, Kanban, or Filter View that spins up a new Table preset. See [[DOCS-025 Filter View|Filter View]].
- The **automatic migration** of presets that predate this file system (see "Migrating older vaults" below).

`Operon/Tables` is a starting point, not a cage. Once a file exists, you can move it anywhere in the vault, rename it, or organize it alongside the project it belongs to, and Operon keeps tracking the same preset at its new location.

## Opening a Table file

Because `.table` is a registered file type, clicking one in the file explorer, or following a wikilink to it, opens it as a genuine Operon Table view: the same toolbar, preset picker, search box, **Group & Sort**, export menu, and related-views control as a table you opened from the command palette. There is no reduced or read-only "file preview" mode; a Table file **is** the table.

A few things follow from that:

- **It restores with your workspace.** If a Table file was open in a tab when you closed Obsidian, it reopens there next time, the same as any other file-backed leaf.
- **It participates in wikilinks.** A link like `[[Overdue Work]]` to a Table file resolves and creates the link the same as a link to any note. See "Wikilinks and Page Preview" below.
- **It is not the same thing as an embed.** Opening the file itself gives you the full Table view in its own tab or leaf. Embedding a table inside a note with an `operon-table` code block is a separate feature that references a preset by its id, not by opening the file directly. See [[DOCS-110 Embed a table in a note|Embed a table in a note]].

## The file and the preset are the same thing

Editing the table from any surface, its own tab, an embed elsewhere, or a second tab open on the same preset, writes straight back to this one file. If the same preset is open in more than one place at once, edits from any of them are saved to the file and every other open surface picks up the change; you never end up with two surfaces silently disagreeing about what the preset looks like.

Embeds keep working across all of this because they reference a preset by its **id**, not its file path. Renaming or moving the `.table` file never breaks an `operon-table` embed elsewhere in your vault; the embed finds the preset wherever its file now lives. See [[DOCS-110 Embed a table in a note|Embed a table in a note]].

## Renaming and moving

A Table file's name and its preset's name are the same thing, and Operon keeps the two in sync automatically, whichever direction you change it from:

- **Rename the file** from Obsidian's file explorer (or however you normally rename a file), and the preset's name, the one shown in the preset picker and every toolbar, updates to match.
- **Rename the preset** instead, from **Edit preset**'s name field, and Operon renames the underlying file to match.

Moving the file to another folder is just a move. Operon notices and keeps tracking it at the new path; nothing else about the preset, its filter, columns, grouping, or embeds pointing at it, changes.

## Deleting a Table file

Deleting a Table file, whether with **Delete** from **Edit preset** or by deleting the file itself from the file explorer, sends it to **Obsidian's Trash**, not a permanent delete. It is recoverable the same way any trashed vault file is.

Deleting also cleans up automatically:

- The preset's position in the preset order and preset picker disappears with it.
- If it was the **default preset**, or a **favorite**, that reference is cleared rather than left dangling.
- Any open tab that was showing the deleted preset falls back to another available preset.
- Any `operon-table` **embed** still pointed at the deleted preset shows **Table preset not found** until you point it at a different one. See [[DOCS-110 Embed a table in a note|Embed a table in a note]].

As with presets generally, you cannot delete the last remaining Table preset; a table always has at least one to fall back to. See [[DOCS-109 Table presets|Table presets]].

## When a file cannot be read

Opening a Table file directly can land on one of two states instead of the table itself:

- **Loading**: a brief moment while Operon reads and parses the file. You should rarely notice this.
- **Invalid**: the file could not be turned into a working preset. Operon shows the file's name, a plain-language reason for each problem found, and the file's raw text underneath, so you can see exactly what is there. It never rewrites, discards, or silently repairs an invalid file; you fix it (by hand, or by restoring an earlier version) and Operon picks it back up automatically once it parses.

A file can be invalid for any of these reasons: the text is not valid JSON; the JSON root is not an object; the `format` value is wrong; the `version` value is one Operon does not support; a required field is missing; a field has the wrong type or an invalid value; the file has a field that is not part of the current version; the file could not be read at all; or its id duplicates another Table file's id (see "Duplicate IDs" below).

## Duplicate IDs

Two Table files can end up sharing the same internal id, most often from copying a `.table` file directly in your file manager instead of using **Duplicate** from the preset settings (**Duplicate** always assigns a fresh id; a raw file copy does not). When that happens, Operon does not guess which file is authoritative. Both files show as invalid until you resolve the conflict.

Resolve it from **Settings → Operon → Views → Tables**: the conflicted entry in the **Table Presets** list is flagged with an **ID conflict** label and offers to keep one file as the original. Choose which file keeps the existing id, and Operon assigns fresh ids to the others and renames them so they load as normal, independent Table presets, no data is lost, they simply become separate tables from that point on.

## Migrating older vaults

If your vault has Table presets from before this file system existed, they migrate into `.table` files automatically, the first time you open this version of Operon:

- Existing presets move into `Operon/Tables`, keeping their name, order, and every setting they already had.
- Operon keeps a **verified backup** of the pre-migration data until you explicitly confirm the migration is done.
- **Settings → Operon → Views → Tables** shows a **Table file migration** status card with one of five states, **Pending**, **Running**, **Needs review**, **Completed**, or **Failed**, and the actions that apply to that state.
- **Needs review** shows up when a preset could not move cleanly, for example its destination filename collided with a file that already existed. The settings card lets you review and resolve those cases individually.
- **Finalize migration** is a separate, explicit step you take once you are satisfied the migrated files are complete and correct. Finalizing **permanently deletes** the verified backup and the detailed migration journal, and cannot be undone, so Operon asks you to confirm before it happens. Until you finalize, the backup and recovery options stay available.
- If a legacy preset's backup is still around, it appears as a **recovery backup** you can restore as a brand-new Table preset, even after the rest of the migration has completed.

All of these actions, retrying the migration, resolving an ID conflict, recovering a backup, and finalizing, live on the migration status card in **Settings → Operon → Views → Tables**, each one appearing only when it is relevant to your vault's current migration state.

## Wikilinks and Page Preview

A `.table` file is an ordinary vault file as far as Obsidian's linking is concerned:

- A `[[wikilink]]` to a Table file resolves, and creates the link, the same as a wikilink to any note.
- Hold **Cmd** (macOS) or **Ctrl** (Windows and Linux) and hover a link to a Table file to get Obsidian's **Page Preview** of it, the same convention used for previewing any other note. This needs Obsidian's core Page Preview plugin enabled; a plain hover without the modifier does not trigger it.

## Tips

> [!tip] Treat Operon/Tables like any other vault folder
> Because a Table file is a real file, everything you already do with vault files works on it: move it into the project folder it belongs to, rename it to match your own naming convention, back it up, or version it alongside your notes. Nothing about editing the table, its presets, or its embeds depends on the file living in any particular folder.

## FAQ

**Can I edit a `.table` file by hand outside Obsidian?** You can, it is plain JSON, but Operon validates it strictly when it loads. A typo, a missing field, or an extra field you added by hand shows up as an invalid file rather than being silently applied. Editing the preset from inside Operon is the reliable path.

**Does renaming the file rename the table I see in the preset picker?** Yes. A Table file's name and its preset's name are the same value; changing either one updates the other automatically.

**Does moving the file break an embedded table in my notes?** No. Embeds reference a preset by its id, not the file's path, so moving or renaming the file never breaks an `operon-table` embed.

**What happens if I delete a Table file that is still embedded somewhere?** The file goes to Obsidian's Trash. Restore it from there to bring the preset back; otherwise, any note still embedding it shows **Table preset not found** until you point that embed at a different preset.

**Two Table files ended up with the same id. What do I do?** In **Settings → Operon → Views → Tables**, the conflicted entry in the Table Presets list is flagged and lets you keep one file as the original. Choose the file that should keep the existing id; the others get new ids and are renamed automatically.

**What happened to my old presets after updating?** They migrated automatically into `.table` files under `Operon/Tables` the first time you opened this version of Operon. See "Migrating older vaults" above.

## Settings

Table file migration status, conflict resolution, and recovery backups all live in **Settings → Operon → Views → Tables**, alongside the rest of the Table Preset settings. Day-to-day renaming, duplicating, and deleting a Table file are done from **Edit preset** or the file's own context menu, not from Settings. See [[DOCS-109 Table presets|Table presets]].

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-109 Table presets|Table presets]]
- [[DOCS-105 Table overview|Table overview]]
- [[DOCS-110 Embed a table in a note|Embed a table in a note]]
- [[DOCS-044 Where Operon stores data|Where Operon stores data]]
