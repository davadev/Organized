import { describe, it, expect } from "vitest";
import { insertTask, NOTE_SECTIONS, noteLoose, noteSection, parseTasks, removeUnique, replaceTask, sortTasks, taskText, writeNoteSection } from "../codec";

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
  it("reads legacy Information as Description and writes canonical sections without dropping neighbours", () => {
    const note = '# Notes\n## Information\nLegacy context\n## Idea\nAn idea\n';
    expect(NOTE_SECTIONS[0]).toBe('Description');
    expect(noteSection(note, 'Description')).toBe('Legacy context');
    expect(noteSection(note, 'Idea')).toBe('An idea');
    expect(noteSection(note, 'Sources')).toBe('');
    const migrated = writeNoteSection(note, 'Description', 'New context');
    expect(migrated).toContain('## Description\nNew context\n'); expect(migrated).not.toContain('## Information'); expect(migrated).toContain('## Idea\nAn idea');
    expect(noteSection(migrated, 'Description')).toBe('New context');
    expect(writeNoteSection('# Notes\n## Description\nOld\n## Idea\nKeep\n', 'Description', 'Fresh')).toContain('## Idea\nKeep');
    expect(writeNoteSection('# Notes\n', 'Sources', 'Line\n')).toContain('## Sources\nLine\n');
    expect(writeNoteSection('# Notes', 'Notes', 'No newline')).toBe('# Notes\n## Notes\nNo newline\n');
    expect(writeNoteSection('', 'Question', 'Why?')).toBe('## Question\nWhy?\n');
    expect(noteLoose(note)).toBe('# Notes');
    expect(noteLoose('Prose\n## Sources\nhttps://example.com\n')).toBe('Prose');
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
});
