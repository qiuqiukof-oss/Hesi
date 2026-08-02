import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explorationVerdict } from '../lib/exploration-verdict.js';

const QS = [
  { id: 'q1', text: '该技术栈是否适合当前团队？', required: true },
  { id: 'q2', text: '迁移成本估算？', required: true },
  { id: 'q3', text: '竞品方案对比（非必需）' },
];

test('全部必需问题有来源可溯 → CONVERGED（下游可决策）', () => {
  const v = explorationVerdict({
    questions: QS,
    answers: [
      { questionId: 'q1', answer: '适合', source: 'docs/eval.md:12' },
      { questionId: 'q2', answer: '约 3 人周', source: 'docs/cost.md:5' },
    ],
    round: 1,
  });
  assert.equal(v.v, 'CONVERGED');
  assert.equal(v.confidence, 1);
  assert.equal(v.missingRequired.length, 0);
});

test('新问题发现 → 只进 future-work，永不阻塞（即使 CONVERGED）', () => {
  const v = explorationVerdict({
    questions: QS,
    answers: [
      { questionId: 'q1', answer: '适合', source: 'a.md' },
      { questionId: 'q2', answer: '3 人周', source: 'b.md' },
    ],
    newQuestions: [{ text: '是否考虑 Serverless 变体？', source: 'round-1' }],
    round: 2,
  });
  assert.equal(v.v, 'CONVERGED');
  assert.equal(v.futureWork.length, 1);
  assert.equal(v.futureWork[0].text, '是否考虑 Serverless 变体？');
});

test('缺必需答案 → CONTINUE + feedback 只催缺答', () => {
  const v = explorationVerdict({
    questions: QS,
    answers: [{ questionId: 'q1', answer: '适合', source: 'a.md' }], // q2 未答
    newQuestions: [{ text: '发现新风险 X' }], // 新问题不罚
    round: 1,
    maxRounds: 5,
  });
  assert.equal(v.v, 'CONTINUE');
  assert.equal(v.missingRequired.length, 1);
  assert.equal(v.missingRequired[0].id, 'q2');
  assert.ok(v.feedback.some((f) => f.includes('迁移成本估算')));
  assert.equal(v.futureWork.length, 1); // 新问题照收
  assert.ok(v.confidence < 1);
});

test('答案无来源（source 空）→ 不算已答', () => {
  const v = explorationVerdict({
    questions: QS,
    answers: [
      { questionId: 'q1', answer: '适合' }, // 无 source
      { questionId: 'q2', answer: '3 人周', source: 'b.md' },
    ],
    round: 1,
    maxRounds: 3,
  });
  assert.equal(v.missingRequired.length, 1); // q1 因无来源仍算缺答
  assert.equal(v.v, 'CONTINUE');
});

test('轮次预算耗尽仍缺必需答案 → ESCALATE（人工介入）', () => {
  const v = explorationVerdict({
    questions: QS,
    answers: [{ questionId: 'q1', answer: '适合', source: 'a.md' }],
    round: 5,
    maxRounds: 5,
  });
  assert.equal(v.v, 'ESCALATE');
  assert.ok(v.why.includes('轮次预算耗尽'));
  assert.equal(v.missingRequired.length, 1);
});

test('无必需问题 → 立即 CONVERGED（信息已足够决策）', () => {
  const v = explorationVerdict({
    questions: [{ id: 'q3', text: '竞品对比' }], // 全部非必需
    answers: [],
    round: 1,
  });
  assert.equal(v.v, 'CONVERGED');
  assert.equal(v.confidence, 1);
});

test('answeredRequiredThreshold：答满 50% 即可决策', () => {
  const v = explorationVerdict({
    questions: QS,
    answers: [{ questionId: 'q1', answer: '适合', source: 'a.md' }], // 2 个必需答了 1 个 = 50%
    answeredRequiredThreshold: 0.5,
    round: 1,
    maxRounds: 3,
  });
  assert.equal(v.v, 'CONVERGED');
  assert.equal(v.confidence, 0.5); // 置信度如实偏低
});
