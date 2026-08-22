/**
 * Bilingual (zh/en) text table for the CLI's user-readable strings
 * (EXPERIENCE.md "Voice and Tone" -- 文案对照表 as the starting point,
 * extended by analogy in the same tone for strings the table doesn't
 * enumerate).
 *
 * `resolveLang()` reads `CONFIGS_LANG` fresh on every call (never cached)
 * -- default `zh`, `CONFIGS_LANG=en` switches to English. It never falls
 * back to `LANG`/`LC_ALL` (Voice and Tone: explicit env var over implicit
 * system locale, same mental model as `NO_COLOR`).
 *
 * Command names, subcommands, flags, `CONFIGS_LANG` itself, and closed
 * enum values (`LaunchPlan.phase`, `ComparisonStatus`, `SourceCategory`,
 * and `computeKnownDifferences`' reason codes) are never translated --
 * they are stable, potentially `grep`-matched identifiers, not
 * explanatory prose (same reasoning as argv/env-var syntax).
 */

export type Lang = 'zh' | 'en';

export function resolveLang(): Lang {
  return process.env.CONFIGS_LANG === 'en' ? 'en' : 'zh';
}

type Dict = Record<string, string>;

const zh: Dict = {
  'emptyList.line1': '未找到已保存的配置修订版本。',
  'emptyList.line2': '本工具只读取已存储在 SQLite 里的配置修订版本；',
  'emptyList.line3': '它自己不创建、不导入、不提供任何配置。',

  'capabilityGroup.instruction': '指令：',
  'capabilityGroup.skill': '技能：',
  'capabilityGroup.mcp': 'MCP：',
  'capabilityGroup.hook': '钩子：',
  'capabilityGroup.plugin': '插件：',
  'capabilityGroup.emptySingle': '（未配置）',
  'capabilityGroup.emptyCompare': '（比较的修订版本中均未配置）',

  'fact.unknown': '未知（{reason}，记录于 {observedAt}）',
  'fact.available': '可用',
  'marker.default': '默认',
  'marker.generic': '通用',
  'capabilityRef.source': '来源',

  'list.revisionLabel': '修订版本',
  'list.statusLabel': '状态',
  'list.boundaryLabel': '边界',

  'detail.configuration': '配置：',
  'detail.revision': '修订版本：',
  'detail.status': '状态：',
  'detail.boundary': '边界：',

  'queryFailure.notFound': '未找到。恢复：运行 `configs list` 查看可用的修订版本 id。',
  'queryFailure.unsupported': '不受支持（{reason}）。恢复：重新导入该修订版本，或检查其存储数据；其他配置不受影响。',
  'queryFailure.prefix': '配置 "{revisionId}"：{reason}',

  'comparison.header': '正在比较 {count} 个修订版本：{ids}',
  'comparison.missingIn': '缺失于：{ids}',
  'comparison.noValid': '没有解析出任何可比较的有效配置修订版本。',
  'comparison.unresolvedTitle': '未解析的 id：',

  'confirmation.lead': '即将使用配置 "{configName}"（修订版本 {revisionId}）启动 OMP。',
  'confirmation.client': '客户端：{client}  版本：{version}',
  'confirmation.knownDifferencesTitle': '已知差异（本 MVP 不会完整应用）：',
  'confirmation.forwardedTitle': '在 `--` 之后原样转发给 `omp`：',
  'confirmation.closing': '这是本次启动计划的一次性确认——之后不会再询问。',
  'confirmation.prompt': '是否继续启动？[y/N] ',

  'launchStatus.revision': '修订版本：{revisionId}',
  'launchStatus.client': '客户端：{client}',
  'launchStatus.clientVersion': '客户端版本：{version}',
  'launchStatus.phase': '阶段：{phase}',
  'launchStatus.applyResult': '应用结果：{result}',
  'launchStatus.knownDifferencesTitle': '已知差异：',
  'launchStatus.knownDifferencesNone': '已知差异：（无）',

  'unsupportedClient': '客户端 "{clientId}" 暂不支持：{reason}',

  'failure.cancelled': '启动计划 {planId} 已取消：{reason}。',
  'failure.notStarted': 'OMP 未启动。',
  'failure.incomplete': '启动计划 {planId} 未完成。',
  'failure.failed': '启动计划 {planId} 失败。',
  'failure.phase': '阶段：{phase}',
  'failure.reason': '原因：{reason}',
  'failure.recovery': '恢复建议：请查看上方原因；运行 `configs show {revisionId}` 重新核查该配置，问题解决后运行 `configs use {revisionId}` 重试。',

  'switchAccepted.requiresRestart': '当前 OMP 进程（计划 {previousPlanId}）现在需要重启才能使用新配置。',
  'switchAccepted.newPlan': '已为修订版本 {revisionId} 创建新的启动计划（{planId}），等待新的确认。',
  'switchAccepted.noAutoResume': '当前进程不会被原地修改，也不会自动恢复。',

  'handoffLine': '终端控制权已交给 omp——直到它退出前，这个终端都是 omp 的。',

  'tui.knownDifferencesMarker': '（有已知差异）',
  'tui.listFooter': '↑↓ 选择 · enter 启动 · → 详情 · q 退出',
  'tui.detailFooter': 'enter 启动 · esc 返回 · q 退出',

  'usage.prefix': '用法：',
  'parseError.missingId': 'configs {command} <id>：缺少 <id>',
  'parseError.compareMinIds': 'configs compare <id> <id> [...ids]：至少需要 2 个 id',
  'parseError.clientRequiresValue': '--client 需要一个值',
  'parseError.unknownFlag': '未知参数：{flag}',
  'parseError.unknownClient': '未知客户端：{client}',
  'parseError.unknownCommand': '未知命令：{command}',
  'parseError.denylistedForwardedArg':
    'configs {command}：转发参数 "{arg}" 不被允许——如果原样传给真实的 `omp` 二进制文件，会破坏本 Story 单一扩展来源/隔离 profile/不自动恢复这几条保证',
  'openDeps.failed': 'configs：无法打开配置存储：{message}',
  'unexpectedFailure': 'configs：意外失败：{message}',
  'launchPlan.notFound': '未找到启动计划 {target}。请先运行 `configs use <id>`。',
  'launchPlan.notFoundTargetForId': '（id 为 "{planId}"）',
  'launchPlan.notFoundTargetNoActive': '（客户端 "omp" 没有活跃的启动计划）',
};

const en: Dict = {
  'emptyList.line1': 'No saved configuration revisions found.',
  'emptyList.line2': 'This CLI only reads configuration revisions already stored in SQLite;',
  'emptyList.line3': 'it does not create, import or supply configuration on its own.',

  'capabilityGroup.instruction': 'Instructions:',
  'capabilityGroup.skill': 'Skills:',
  'capabilityGroup.mcp': 'MCP:',
  'capabilityGroup.hook': 'Hooks:',
  'capabilityGroup.plugin': 'Plugins:',
  'capabilityGroup.emptySingle': '(none configured)',
  'capabilityGroup.emptyCompare': '(none in any compared revision)',

  'fact.unknown': 'Unknown ({reason}, observed {observedAt})',
  'fact.available': 'available',
  'marker.default': 'default',
  'marker.generic': 'generic',
  'capabilityRef.source': 'source',

  'list.revisionLabel': 'revision',
  'list.statusLabel': 'status',
  'list.boundaryLabel': 'boundary',

  'detail.configuration': 'Configuration:',
  'detail.revision': 'Revision:',
  'detail.status': 'Status:',
  'detail.boundary': 'Boundary:',

  'queryFailure.notFound': 'not found. Recovery: run `configs list` to see available revision ids.',
  'queryFailure.unsupported': 'unsupported ({reason}). Recovery: re-seed this revision or inspect its stored data; other configurations are unaffected.',
  'queryFailure.prefix': 'Configuration "{revisionId}": {reason}',

  'comparison.header': 'Comparing {count} revision(s): {ids}',
  'comparison.missingIn': 'missing in: {ids}',
  'comparison.noValid': 'No valid configuration revisions were resolved to compare.',
  'comparison.unresolvedTitle': 'Unresolved ids:',

  'confirmation.lead': 'About to launch OMP with configuration "{configName}" (revision {revisionId}).',
  'confirmation.client': 'Client: {client}  version: {version}',
  'confirmation.knownDifferencesTitle': 'Known differences (will not be fully applied in this MVP):',
  'confirmation.forwardedTitle': 'Forwarded to `omp` verbatim after `--`:',
  'confirmation.closing': 'This is a one-time confirmation for this launch plan -- nothing else will ask again.',
  'confirmation.prompt': 'Proceed with this launch? [y/N] ',

  'launchStatus.revision': 'Revision: {revisionId}',
  'launchStatus.client': 'Client: {client}',
  'launchStatus.clientVersion': 'Client version: {version}',
  'launchStatus.phase': 'Phase: {phase}',
  'launchStatus.applyResult': 'Apply result: {result}',
  'launchStatus.knownDifferencesTitle': 'Known differences:',
  'launchStatus.knownDifferencesNone': 'Known differences: (none)',

  'unsupportedClient': 'Client "{clientId}" is not supported yet: {reason}',

  'failure.cancelled': 'Launch plan {planId} was cancelled: {reason}.',
  'failure.notStarted': 'OMP was not started.',
  'failure.incomplete': 'Launch plan {planId} did not complete.',
  'failure.failed': 'Launch plan {planId} failed.',
  'failure.phase': 'Phase: {phase}',
  'failure.reason': 'Reason: {reason}',
  'failure.recovery': 'Recovery: inspect the reason above; run `configs show {revisionId}` to re-check the configuration, then `configs use {revisionId}` to retry once resolved.',

  'switchAccepted.requiresRestart': 'Current OMP process (plan {previousPlanId}) now requires a restart to use a new configuration.',
  'switchAccepted.newPlan': 'A new launch plan ({planId}) was created for revision {revisionId} and awaits a fresh confirmation.',
  'switchAccepted.noAutoResume': 'The current process is not modified in place and will not auto-resume.',

  'handoffLine': "Handing off to omp — this terminal is omp's until it exits.",

  'tui.knownDifferencesMarker': '(has known differences)',
  'tui.listFooter': '↑↓ select · enter use · → details · q quit',
  'tui.detailFooter': 'enter use · esc back · q quit',

  'usage.prefix': 'usage:',
  'parseError.missingId': 'configs {command} <id>: missing <id>',
  'parseError.compareMinIds': 'configs compare <id> <id> [...ids]: requires at least 2 ids',
  'parseError.clientRequiresValue': '--client requires a value',
  'parseError.unknownFlag': 'unknown flag: {flag}',
  'parseError.unknownClient': 'unknown client: {client}',
  'parseError.unknownCommand': 'unknown command: {command}',
  'parseError.denylistedForwardedArg':
    "configs {command}: forwarded argument \"{arg}\" is not allowed -- it would defeat this Story's single-extension-source/isolated-profile/no-auto-resume guarantees when passed through to the real `omp` binary",
  'openDeps.failed': 'configs: could not open configuration storage: {message}',
  'unexpectedFailure': 'configs: unexpected failure: {message}',
  'launchPlan.notFound': 'No launch plan found {target}. Run `configs use <id>` first.',
  'launchPlan.notFoundTargetForId': 'for id "{planId}"',
  'launchPlan.notFoundTargetNoActive': '(no active plan for client "omp")',
};

const DICTS: Record<Lang, Dict> = { zh, en };

/**
 * Exposed only so `tests/cli/i18n.test.ts` can assert key-set parity
 * between the two dictionaries (a missing translation should be caught by
 * that test, not silently degrade to a raw dictionary key at runtime) --
 * not meant to be read by any other production code.
 */
export const dictsForTesting: Readonly<Record<Lang, Dict>> = DICTS;

export type TranslationKey = keyof typeof zh;

function otherLang(lang: Lang): Lang {
  return lang === 'en' ? 'zh' : 'en';
}

/**
 * Looks up `key` in the dictionary for the currently-resolved language and
 * substitutes any `{name}` placeholders from `params`. Values that are
 * themselves closed enum values (phase names, reason codes, ids) are always
 * passed in via `params` rather than baked into the dictionary strings, so
 * they are never accidentally translated.
 *
 * Falls back to the *other* language's dictionary (not the same one twice)
 * before falling back to the raw key -- a gap in one dictionary degrades to
 * a real, readable sentence in the other language rather than a raw
 * `dot.separated.key` leaking into user-facing output.
 */
export function t(key: TranslationKey, params?: Readonly<Record<string, string | number>>): string {
  const lang = resolveLang();
  let template = DICTS[lang][key] ?? DICTS[otherLang(lang)][key] ?? key;
  if (params !== undefined) {
    for (const [name, value] of Object.entries(params)) {
      template = template.split(`{${name}}`).join(String(value));
    }
  }
  return template;
}
