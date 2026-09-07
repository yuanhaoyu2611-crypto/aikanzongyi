const test = require('node:test');
const assert = require('node:assert/strict');

const {
  expandCompactWeekdays,
  youkuScheduleFromNotice,
} = require('../.static-server.cjs');

test('expands compact weekday lists from platform notices', () => {
  assert.equal(expandCompactWeekdays('每周三四12:30更新'), '每周三、周四12:30更新');
  assert.equal(expandCompactWeekdays('每周日、周一12:00双更'), '每周日、周一12:00双更');
});

test('parses Youku membership schedules and same-day episode batches', () => {
  const schedule = youkuScheduleFromNotice(
    '22期全（6月16日起每周二中午12点SVIP连更2期；每周三四中午12点VIP连更2期）',
    '2026',
    '',
  );

  assert.deepEqual(schedule, [
    { weekday: 2, time: '12:00', partLabel: '正片 1/2', startDate: '2026-06-16', audience: 'SVIP', firstEpisode: 1, episodeStep: 2 },
    { weekday: 2, time: '12:00', partLabel: '正片 2/2', startDate: '2026-06-16', audience: 'SVIP', firstEpisode: 2, episodeStep: 2 },
    { weekday: 3, time: '12:00', partLabel: '正片', startDate: '2026-06-17', audience: 'VIP', firstEpisode: 1, episodeStep: 2 },
    { weekday: 4, time: '12:00', partLabel: '正片', startDate: '2026-06-18', audience: 'VIP', firstEpisode: 2, episodeStep: 2 },
  ]);
});
