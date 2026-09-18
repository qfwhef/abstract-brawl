import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const c = { console };
c.window = c;
vm.createContext(c);
for (const f of ['assets', 'roster', 'meme-roster', 'roster-revision3', 'turn-engine', 'turn-cast', 'turn-data']) {
  vm.runInContext(fs.readFileSync(path.join(root, f + '.js'), 'utf8'), c);
}
const Roster = c.TURN_ROSTER;
const Battle = c.AbstractTactics.Battle;

const xiangwan = Roster.find(x => x.name.includes('向晚'));
const xiaolu = Roster.find(x => x.name.includes('四时小路'));
console.log('找到角色:', xiangwan.name, 'id=' + xiangwan.id, xiaolu.name, 'id=' + xiaolu.id);

const other = Roster.filter(x => x.id !== xiangwan.id && x.id !== xiaolu.id);
const team0 = [
  { id: xiangwan.id, cell: 0 },
  { id: xiaolu.id, cell: 1 },
  { id: other[0].id, cell: 2 },
  { id: other[1].id, cell: 3 },
];
const team1 = [
  { id: other[2].id, cell: 0 },
  { id: other[3].id, cell: 1 },
  { id: other[4].id, cell: 2 },
  { id: other[5].id, cell: 3 },
];

const b = new Battle(Roster, [team0, team1], { seed: 12345 });

const uXiangwan = b.units.find(u => u.data.id === xiangwan.id);
const uXiaolu = b.units.find(u => u.data.id === xiaolu.id);
uXiangwan.energy = 100;
uXiaolu.energy = 100;

// 测试向晚的技能 2: 顶碗节拍 (target: ally)
b.active = uXiangwan.uid;
const targetsXiangwan = b.targets(uXiangwan, uXiangwan.data.skills[2]);
console.log('向晚“顶碗节拍”合法目标数量:', targetsXiangwan.length);
const res1 = b.act(2, uXiaolu.uid);
console.log('向晚释放“顶碗节拍”给四时小路:', res1.ok, res1.reason || '成功');
if (!res1.ok) {
  console.error('向晚释放技能失败');
  process.exit(1);
}

// 测试四时小路的技能 1: 路口禁止通行 (target: ally)
b.active = uXiaolu.uid;
const targetsXiaolu = b.targets(uXiaolu, uXiaolu.data.skills[1]);
console.log('四时小路“路口禁止通行”合法目标数量:', targetsXiaolu.length);
const res2 = b.act(1, uXiangwan.uid);
console.log('四时小路释放“路口禁止通行”给向晚:', res2.ok, res2.reason || '成功');
if (!res2.ok) {
  console.error('四时小路释放技能失败');
  process.exit(1);
}

// 再测试 2P (Side 1) 出招情况
const team1Xiangwan = [
  { id: other[2].id, cell: 0 },
  { id: other[3].id, cell: 1 },
  { id: xiangwan.id, cell: 2 },
  { id: xiaolu.id, cell: 3 },
];
const b2 = new Battle(Roster, [team0, team1Xiangwan], { seed: 54321 });
const u2Xiangwan = b2.units.find(u => u.side === 1 && u.data.id === xiangwan.id);
const u2Xiaolu = b2.units.find(u => u.side === 1 && u.data.id === xiaolu.id);
u2Xiangwan.energy = 100;
b2.active = u2Xiangwan.uid;
const res3 = b2.act(2, u2Xiaolu.uid);
console.log('Side 1（2P）向晚释放“顶碗节拍”给 2P 队友四时小路:', res3.ok, res3.reason || '成功');
if (!res3.ok) {
  console.error('2P向晚释放技能失败');
  process.exit(1);
}

console.log('All character skill executions verified successfully!');
