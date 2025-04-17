import fs from 'fs';

export function loadStackConfig(stackName: string) {
  const raw = fs.readFileSync(`./stacks/${stackName}.json`, 'utf-8');
  return JSON.parse(raw);
}
