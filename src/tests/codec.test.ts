import { describe, it, expect } from "vitest";
import { descendants, insertTask, readNote, hasLegacyHeading, migrateNote, noteSection, parseTasks, removeUnique, replaceTask, sortTasks, taskText, writeNoteSection } from "../codec";

describe("Markdown task codec", () => {
  it('uses real Markdown structure for nested fences, indented code, comments and setext headings', () => {
    const text = '- [ ] Parent\n\n  ```md\n  - [ ] nested fenced code\n  ```\n\n  paragraph\n\n      - [ ] nested indented code\n\n<!--\n- [ ] hidden comment\n-->\n\n<pre>\n- [ ] HTML code\n</pre>\n\nHeading\n=======\n- [ ] Actual\n';
    expect(parseTasks(text).map(t => t.title)).toEqual(['Parent', 'Actual']); expect(parseTasks(text)[1].section).toEqual([{ level: 1, text: 'Heading', ordinal: 0 }]);
    expect(parseTasks('---\ntitle: unfinished\n- [ ] YAML')).toEqual([]);
    expect(parseTasks('---\n---\n- [ ] Real').map(t => t.title)).toEqual(['Real']);
    expect(parseTasks('- ordinary list item\n- [ ] Real').map(t => t.title)).toEqual(['Real']);
  });
  it("ignores YAML, code, blockquotes and prose; keeps heading identity", () => {
    const text = '---\n- [ ] yaml\n---\n# Work\n- [ ] actual <!--organized:task1234-->\n    - [/] nested\n```md\n- [ ] code\n~~~~\n```\n> - [ ] quote\n\n    - [ ] indented\n## Sub\n- [x] done\n## Sub\n- [?] question\n# Work\n- [ ] second\nprose - [ ] not a task';
    const tasks = parseTasks(text); expect(tasks.map(t => t.title)).toEqual(["actual", "nested", "done", "question", "second"]);
    expect(tasks[0].id).toBe("task1234"); expect(tasks[0].section).toEqual([{ level: 1, text: "Work", ordinal: 0 }]); expect(tasks[3].section[1].ordinal).toBe(1); expect(tasks[4].section[0].ordinal).toBe(1);
    expect(parseTasks('---\n- [ ] yaml\n...\n- [ ] real')).toHaveLength(1);
    expect(parseTasks('- [ ] duplicate <!--organized:task1234--> <!--organized:task5678-->')).toEqual([]);
    expect(parseTasks('\t- [ ] code')).toEqual([]); expect(parseTasks('~~~\n- [ ] nope\n~~~\n- [ ] yes')).toHaveLength(1);
  });
  it("preserves source markers, identity, nesting, CRLF and hidden repeat tag", () => {
    const text = '# A\r\n- [>] Do it <!--organized:task1234--> <!--organized:repeat-->\r\n'; const t = parseTasks(text)[0];
    expect(taskText(t, {})).toBe(t.raw); expect(taskText(t, { marker: "x", title: "Done", id: "task5678", repeat: false })).toBe('- [x] Done <!--organized:task5678-->\r');
    expect(replaceTask(text, t, { marker: " " })).toContain('- [ ] Do it <!--organized:task1234--> <!--organized:repeat-->\r\n');
    expect(() => replaceTask("changed", t, {})).toThrow(); expect(taskText(parseTasks('- [ ] plain')[0], {})).toBe('- [ ] plain');
  });
  it("inserts without overwriting and removes only unique managed occurrences", () => {
    const section = [{ level: 1, text: "Work", ordinal: 0 }];
    expect(insertTask('# Work\nProse\n# Next\n', '- [ ] A', section)).toEqual({ text: '# Work\nProse\n- [ ] A\n# Next\n', missing: false });
    expect(insertTask('# Other\n', '- [ ] A', section)).toMatchObject({ missing: true });
    expect(insertTask('Text', '- [ ] A', [])).toEqual({ text: 'Text\n- [ ] A', missing: false });
    expect(insertTask('# First\n', '- [ ] A', []).text).toBe('- [ ] A\n# First\n');
    expect(insertTask('# Work\r\n', '- [ ] A', section).text).toContain('\r\n');
    const line = '- [ ] A <!--organized:task1234-->';
    expect(removeUnique(line + '\nprose', 'task1234')).toBe('prose');
    expect(() => removeUnique(line + '\n' + line, 'task1234')).toThrow(); expect(() => removeUnique(line, 'task1234', true)).toThrow();
    expect(removeUnique(line + ' <!--organized:repeat-->', 'task1234', true)).toBe('');
  });
  it("writes the description as the note text, with `## Sources` as the only heading", () => {
    expect(writeNoteSection('---\nid: x\n---\n\n', 'Description', 'Plan the trip.')).toBe('---\nid: x\n---\n\nPlan the trip.\n');
    const withSources = writeNoteSection('---\nid: x\n---\n\nPlan the trip.\n', 'Sources', 'https://a.b\n');
    expect(withSources).toBe('---\nid: x\n---\n\nPlan the trip.\n\n## Sources\nhttps://a.b\n');
    expect(noteSection(withSources.split('---\n')[2], 'Description')).toBe('Plan the trip.'); expect(noteSection(withSources.split('---\n')[2], 'Sources')).toBe('https://a.b');
    expect(writeNoteSection(withSources, 'Description', 'Changed')).toBe('---\nid: x\n---\n\nChanged\n\n## Sources\nhttps://a.b\n');
    expect(writeNoteSection(withSources, 'Sources', '')).toBe('---\nid: x\n---\n\nPlan the trip.\n');
    expect(writeNoteSection('', 'Sources', 'Why?')).toBe('## Sources\nWhy?\n'); expect(writeNoteSection('# Title', 'Description', 'No newline')).toBe('No newline\n');
    expect(writeNoteSection('---\nid: x\n---\n', 'Description', '')).toBe('---\nid: x\n---\n\n');
  });
  it("reads either layout and keeps every word of an old note when rewriting it", () => {
    const old = 'Lead\n## Information\nLegacy context\n## Idea\nAn idea\n## Sources\nhttps://a.b\n## Notes\nn1\n';
    expect(readNote(old)).toEqual({ description: 'Legacy context\n\nn1\n\nLead\n\n## Idea\nAn idea', sources: 'https://a.b' });
    expect(hasLegacyHeading(old)).toBe(true); expect(hasLegacyHeading('## Notes\nonly')).toBe(true); expect(hasLegacyHeading('Plain\n## Plan\n')).toBe(false);
    expect(writeNoteSection('---\nid: x\n---\n\n## Description\nOld\n## Notes\nn\n', 'Sources', 'https://c.d')).toBe('---\nid: x\n---\n\nOld\n\nn\n\n## Sources\nhttps://c.d\n');
    // A new-format description may hold headings of its own, including `## Notes`.
    expect(readNote('Intro\n\n## Notes\nmine\n\n## Plan\ntext\n')).toEqual({ description: 'Intro\n\n## Notes\nmine\n\n## Plan\ntext', sources: '' });
    expect(readNote('Intro\n\n## Sources\nhttps://a.b\n\n## After\ntail\n')).toEqual({ description: 'Intro\n\n## After\ntail', sources: 'https://a.b' });
    expect(readNote('## Sources\nonly\n')).toEqual({ description: '', sources: 'only' }); expect(readNote('')).toEqual({ description: '', sources: '' });
    expect(readNote('Old\r\n## Description\r\nbody\r\n')).toEqual({ description: 'body\n\nOld', sources: '' });
  });
  it("migrates an old note once, keeping line endings, front matter and duplicated headings", () => {
    const old = '---\nid: x\ntitle: T\n---\n\n## Description\nOne\n## Notes\nTwo\n## Description\nThree\n## Sources\nhttps://a.b\n';
    const migrated = migrateNote(old)!;
    expect(migrated).toBe('---\nid: x\ntitle: T\n---\n\nOne\n\nThree\n\nTwo\n\n## Sources\nhttps://a.b\n');
    expect(migrateNote(migrated)).toBeNull(); expect(hasLegacyHeading(migrated)).toBe(false);
    expect(migrateNote('---\nid: x\n---\n\nPlain text\n')).toBeNull(); expect(migrateNote('---\nid: x\n---\n')).toBeNull();
    expect(migrateNote('---\r\nid: x\r\n---\r\n\r\n## Description\r\nBody\r\n## Notes\r\nMore\r\n')).toBe('---\r\nid: x\r\n---\r\n\r\nBody\r\n\r\nMore\r\n');
    expect(migrateNote('## Notes\nOnly notes\n')).toBe('Only notes\n'); expect(migrateNote('## Description\n')).toBe('');
    expect(migrateNote('Same\n## Description\nSame\n')).toBe('Same\n\nSame\n');
  });
  it("lets plain bullets sit inside a sorted list and puts finished, forwarded and scheduled todos below open ones, even without a priority", () => {
    const priorities = new Map([['task_aaa', 'low' as const], ['task_bbb', 'high' as const], ['task_ccc', 'medium' as const]]);
    const linked = '- [ ] low <!--organized:task_aaa-->\n- [[Notes/Converted]]\n- [/] high <!--organized:task_bbb-->';
    expect(sortTasks(linked, 2, 'list', priorities)).toBe('- [/] high <!--organized:task_bbb-->\n- [[Notes/Converted]]\n- [ ] low <!--organized:task_aaa-->');
    expect(sortTasks('- [ ] low <!--organized:task_aaa-->\n  - [[Nested]]\n- [/] high <!--organized:task_bbb-->', 2, 'list', priorities)).toBe('- [/] high <!--organized:task_bbb-->\n- [ ] low <!--organized:task_aaa-->\n  - [[Nested]]');
    expect(sortTasks('- [ ] low <!--organized:task_aaa-->\nProse\n- [/] high <!--organized:task_bbb-->', 2, 'list', priorities)).toBe('- [ ] low <!--organized:task_aaa-->\nProse\n- [/] high <!--organized:task_bbb-->');
    const none = '- [x] done <!--organized:task_ddd1-->\n- [>] fwd <!--organized:task_ddd2-->\n- [<] sched <!--organized:task_ddd3-->\n- [ ] open <!--organized:task_ddd4-->\n- [ ] low <!--organized:task_aaa-->';
    expect(sortTasks(none, 4, 'list', priorities).split('\n').map(l => l.slice(0, 5))).toEqual(['- [ ] ', '- [ ] ', '- [x] ', '- [>] ', '- [<] '].map(l => l.slice(0, 5)));
    for (const marker of ['x', 'X', '-']) expect(sortTasks(`- [${marker}] high <!--organized:task_bbb-->\n- [ ] medium <!--organized:task_ccc-->\n- [ ] low <!--organized:task_aaa-->`, 0, 'list', priorities)).toBe(`- [ ] medium <!--organized:task_ccc-->\n- [ ] low <!--organized:task_aaa-->\n- [${marker}] high <!--organized:task_bbb-->`);
  });
  it("sorts only safe sibling positions, never prose, headings or subtask blocks", () => {
    const text = '# A\n- [ ] low <!--organized:task_low-->\n- [ ] high <!--organized:taskhigh-->\n\nProse\n- [ ] medium <!--organized:task_med-->\n# B\n- [ ] other';
    const priorities = new Map([['task_low', 'low' as const], ['taskhigh', 'high' as const], ['task_med', 'medium' as const]]);
    expect(sortTasks(text, 1, 'none', priorities)).toBe(text); expect(sortTasks(text, 0, 'list', priorities)).toBe(text);
    expect(sortTasks(text, 1, 'list', priorities).split('\n')[1]).toContain('high');
    expect(sortTasks(text, 1, 'section', priorities).split('\n')[2]).toContain('medium');
    expect(sortTasks(text, 2, 'first', priorities).split('\n')[1]).toContain('high');
    expect(sortTasks('- [ ] parent\n    child\n- [ ] next', 0, 'section', priorities)).toBe('- [ ] parent\n    child\n- [ ] next');
    expect(sortTasks('- [ ] plain\n- [ ] another', 1, 'list', priorities)).toBe('- [ ] plain\n- [ ] another');
  });
  it('keeps forwarded tasks adjacent instead of separating each with a blank line', () => {
    const work = [{ level: 2, text: 'Work', ordinal: 0 }]; const home = [{ level: 2, text: 'Home', ordinal: 0 }];
    let text = '';
    for (const [task, section] of [['A', work], ['B', work], ['C', home], ['D', work], ['E', home]] as const) text = insertTask(text, `- [ ] ${task}`, [...section]).text;
    expect(text).toBe('## Work\n\n- [ ] A\n- [ ] B\n- [ ] D\n\n## Home\n\n- [ ] C\n- [ ] E\n');
    expect(insertTask('## Todos\n\n## Log\n', '- [ ] A', [{ level: 2, text: 'Todos', ordinal: 0 }]).text).toBe('## Todos\n\n- [ ] A\n## Log\n');
    expect(insertTask('# Day\n\n## Todos\n- [ ] A\n\n\n## Log\n', '- [ ] B', [{ level: 1, text: 'Day', ordinal: 0 }, { level: 2, text: 'Todos', ordinal: 0 }]).text).toBe('# Day\n\n## Todos\n- [ ] A\n- [ ] B\n\n\n## Log\n');
    expect(insertTask('# Day', '- [ ] A', [{ level: 1, text: 'New', ordinal: 0 }]).text).toBe('# Day\n\n# New\n\n- [ ] A\n');
    expect(insertTask('# Day\n- [ ] A\n# Last', '- [ ] B', [{ level: 1, text: 'Day', ordinal: 0 }]).text).toBe('# Day\n- [ ] A\n- [ ] B\n# Last');
  });
  it("keeps other headings inside an old section as its content, ending it only at the next old section heading", () => {
    const note = '## Description\nIntro\n\n## Plan\n### Deep\ntext\n\n## Sources\nhttps://a.b\n\n## Notes\nn1\n';
    expect(noteSection(note, 'Description')).toBe('Intro\n\n## Plan\n### Deep\ntext\n\nn1'); expect(noteSection(note, 'Sources')).toBe('https://a.b');
    expect(writeNoteSection(note, 'Description', 'New\n\n## Kept')).toBe('New\n\n## Kept\n\n## Sources\nhttps://a.b\n');
    expect(noteSection('## Description\nOnly\n## Notes', 'Description')).toBe('Only'); expect(noteSection('## Description\nOld\n## Idea\nlegacy\n', 'Description')).toBe('Old\n\n## Idea\nlegacy');
  });
  it("sorts in-progress lines first and ranks forwarded and scheduled lines below every open todo", () => {
    const priorities = new Map<string, any>([['aaaaaaaa1', 'high'], ['bbbbbbbb1', 'high'], ['cccccccc1', 'medium'], ['dddddddd1', 'none'], ['eeeeeeee1', 'low']]);
    const text = ['- [>] Forwarded high <!--organized:aaaaaaaa1-->', '- [<] Scheduled high <!--organized:bbbbbbbb1-->', '- [ ] Medium <!--organized:cccccccc1-->', '- [ ] None <!--organized:dddddddd1-->', '- [/] Low but running <!--organized:eeeeeeee1-->', '- [!] Plain running'].join('\n').replace('[!] Plain running', '[/] Plain running');
    const titles = (out: string) => out.split('\n').map(l => l.replace(/^- \[.\] | <!--.*$/g, ''));
    expect(titles(sortTasks(text, 2, 'list', priorities))).toEqual(['Low but running', 'Plain running', 'Medium', 'None', 'Forwarded high', 'Scheduled high']);
    expect(titles(sortTasks(text, 2, 'none', priorities))).toEqual(titles(text)); expect(titles(sortTasks(text, 4, 'first', priorities))[0]).toBe('Low but running');
  });
  it('knows which todo each todo is nested under, through plain bullets, and ignores plain-bullet and code parents', () => {
    const text = ['- [ ] Top', '  - [ ] Child', '    - [ ] Grandchild', '  - A note', '    - [ ] Under a note', '- [ ] Second', '- Plain', '  - [ ] Not a subtask', '```', '- [ ] fenced', '```', '- [ ] Last'].join('\n');
    const tasks = parseTasks(text); const parents = Object.fromEntries(tasks.map(t => [t.title, t.parent === null ? null : tasks.find(p => p.line === t.parent)!.title]));
    expect(parents).toEqual({ Top: null, Child: 'Top', Grandchild: 'Child', 'Under a note': 'Top', Second: null, 'Not a subtask': null, Last: null });
    expect(descendants(tasks, 0).map(t => t.title)).toEqual(['Child', 'Grandchild', 'Under a note']); expect(descendants(tasks, 5)).toEqual([]);
    expect(parseTasks('- [ ] Two ids <!--organized:aaaaaaaa--> <!--organized:bbbbbbbb-->\n  - [ ] Child')[0].parent).toBeNull();
  });
  it('sorts subtasks only among the subtasks of the same parent, in every scope', () => {
    const priorities = new Map([['aaaaaaa1', 'none'], ['aaaaaaa2', 'high'], ['bbbbbbb1', 'none'], ['bbbbbbb2', 'high']] as const);
    const text = ['- [ ] A <!--organized:aaaaaaa0-->', '  - [ ] A low <!--organized:aaaaaaa1-->', '  - [ ] A high <!--organized:aaaaaaa2-->', '- [ ] B <!--organized:bbbbbbb0-->', '  - [ ] B low <!--organized:bbbbbbb1-->', '  - [ ] B high <!--organized:bbbbbbb2-->'].join('\n');
    const titles = (out: string) => out.split('\n').map(l => l.replace(/^\s*- \[.\] | <!--.*$/g, ''));
    for (const scope of ['list', 'section', 'first'] as const) expect(titles(sortTasks(text, 2, scope, priorities)), scope).toEqual(['A', 'A high', 'A low', 'B', 'B low', 'B high']);
  });
});

describe('inserting under a lone heading', () => {
  it('reuses that heading when the note nests it deeper, instead of adding a copy each time', () => {
    const lone = [{ level: 2, text: 'Habits', ordinal: 0 }];
    let text = '# Day\n\n## Habits\n\n## Notes\nText\n';
    for (const title of ['One', 'Two', 'Three']) { const result = insertTask(text, `- [ ] ${title}`, lone); expect(result.missing).toBe(false); text = result.text; }
    expect(text.match(/## Habits/g)).toHaveLength(1); expect(text.indexOf('Three')).toBeLessThan(text.indexOf('## Notes'));
  });
  it('still creates the heading when no heading of that name and level exists, and picks the right one of several', () => {
    const lone = [{ level: 2, text: 'Habits', ordinal: 0 }];
    expect(insertTask('# Day\n', '- [ ] One', lone).missing).toBe(true); expect(insertTask('# Day\n### Habits\n', '- [ ] One', lone).missing).toBe(true);
    const second = insertTask('# A\n## Habits\n# B\n## Habits\n## End\n', '- [ ] One', [{ level: 2, text: 'Habits', ordinal: 1 }]); expect(second.missing).toBe(false); expect(second.text.indexOf('One')).toBeGreaterThan(second.text.lastIndexOf('## Habits')); expect(second.text.indexOf('One')).toBeLessThan(second.text.indexOf('## End'));
  });
});
