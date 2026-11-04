import { execFileSync } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import sharp from 'sharp';

const source = process.argv[2] ?? '.work/game';
const destination = resolve('reports/repository');
await mkdir(destination, { recursive: true });
const commit = execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], {
  encoding: 'utf8',
}).trim();
for (const name of ['repocarto']) {
  await sharp(await readFile(join(destination, `${name}.svg`)), {
    density: 144,
  })
    .resize({ width: 2000, withoutEnlargement: true })
    .png()
    .toFile(join(destination, `${name}.png`));
}
const metadata = {
  repository: 'idle-arcade/game',
  commit,
  repocarto: {
    action: 'b1a8d6de32d9ef2e32c538be320e4588c7630212',
    package: '0.1.2',
  },
};
await writeFile(
  join(destination, 'source.json'),
  JSON.stringify(metadata, null, 2) + '\n',
);
let gource = '';
try {
  const provenance = JSON.parse(
    await readFile(join(destination, 'gource-source.json'), 'utf8'),
  ) as { commit: string };
  gource = `\n\n## Gource still\n\n![Gource repository tree](gource.png)\n\nReal Git history rendered by Gource, retaining its final frame as a PNG. Source commit: [${provenance.commit.slice(0, 8)}](https://github.com/idle-arcade/game/commit/${provenance.commit}). The still keeps idle files visible and hides people/motion so directory structure remains the focus. Gource and Repocarto are regenerated together on every scheduled or manual run. No video is stored.\n`;
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}
await writeFile(
  join(destination, 'README.md'),
  `# IDLE Arcade repository maps\n\nSource: [idle-arcade/game at ${commit.slice(0, 8)}](https://github.com/idle-arcade/game/commit/${commit}). These images show file/folder structure, not runtime dependencies or software architecture. Generated artifacts stay in the charts repository; the game checkout is read-only.\n\n## Repocarto\n\n![Repocarto](repocarto.svg)\n\n[PNG](repocarto.png) · [Existing upstream renderer](https://github.com/aurelio-nakamura/repocarto). Nested circles represent directories; file area represents lines of code and color represents language. The scan uses tracked source files with build/dependency folders, lockfiles, drawing source files and binary assets omitted in a temporary visualization checkout. Both the action and npm package are pinned.\n${gource}`,
);
