export type ZeesVerifierStatus = 'proved' | 'partial' | 'blocked' | 'na';

export type ZeesProduct = {
  slug: string;
  description: string;
  publicUrl: string;
  checkoutUrl: string;
  deliveryModel: string;
  channels: string[];
  gates: { legal: boolean; payment: boolean; fulfillment: boolean; support: boolean };
  audit: { engineering: number | null; infrastructure: number | null; ux: number | null; observability: number | null };
};

export type ZeesSystem = {
  status?: string;
  sha?: string;
  ci?: string;
  domain?: string;
  availability?: number | null;
  evidence?: string[];
};

export type ZeesVerifierContext = {
  product: ZeesProduct;
  profile: string;
  sourceSystem?: ZeesSystem;
  sourceSha: string;
};

export type ZeesVerifierResult = {
  status: ZeesVerifierStatus;
  message: string;
  artifacts: string[];
};

type HttpProbe = {
  ok: boolean;
  status: number;
  latencyMs: number;
  finalUrl: string;
  contentType: string;
  bodySample: string;
  securityHeaders: string[];
  error: string;
};

function unique(items: string[]) {
  return Array.from(new Set(items.filter(Boolean))).slice(0, 24);
}

function evidence(ctx: ZeesVerifierContext, pattern: RegExp) {
  return (ctx.sourceSystem?.evidence || []).filter(item => pattern.test(item));
}

function result(status: ZeesVerifierStatus, message: string, artifacts: string[] = []): ZeesVerifierResult {
  return { status, message, artifacts: unique(artifacts) };
}

async function exactZevanoryCoreProof(pillar: string, ctx: ZeesVerifierContext): Promise<ZeesVerifierResult | null> {
  if (ctx.product.slug !== 'zevanory') return null;
  const reusable = new Set(['P01','P02','P04','P06','P10','P14','P15']);
  if (!reusable.has(pillar)) return null;
  try {
    const response = await fetch('https://zevanory.api.br/api/core/v1/snapshot', {
      headers: { accept: 'application/json', 'user-agent': 'ZEVANORY-ZEES-16/2026.09-product-certifier' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const snapshot = await response.json() as any;
    const releaseSha = String(snapshot?.release_sha || '');
    const decisionHash = String(snapshot?.zees16?.decision_hash || '');
    const declaredSourceSha = String(ctx.sourceSystem?.sha || '');
    if (!releaseSha) return null;
    if (declaredSourceSha && releaseSha !== declaredSourceSha) return null;
    const item = Array.isArray(snapshot?.zees16?.pillars)
      ? snapshot.zees16.pillars.find((entry: any) => String(entry?.id || '') === pillar)
      : null;
    if (!item || String(item?.state || '').toUpperCase() !== 'PROVADO') return null;
    const evidenceItems = Array.isArray(item?.evidence)
      ? item.evidence.filter((entry: any) => entry?.ok === true).map((entry: any) => String(entry?.url || entry?.key || '')).filter(Boolean)
      : [];
    return result('proved', 'Pilar comprovado pelo ZEES-16 canônico da mesma release do produto ZEVANORY.', [
      `core_release:${releaseSha}`,
      decisionHash ? `zees16_decision:${decisionHash}` : '',
      ...evidenceItems,
    ]);
  } catch {
    return null;
  }
}

async function probeHttp(url: string): Promise<HttpProbe> {
  if (!/^https?:\/\//i.test(url || '')) {
    return { ok: false, status: 0, latencyMs: 0, finalUrl: '', contentType: '', bodySample: '', securityHeaders: [], error: 'url_missing_or_invalid' };
  }
  const started = Date.now();
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { accept: 'text/html,application/json;q=0.9,*/*;q=0.8', 'user-agent': 'ZEVANORY-ZEES-16/2026.09' },
      signal: AbortSignal.timeout(10_000),
    });
    const contentType = response.headers.get('content-type') || '';
    let bodySample = '';
    if (/text|html|json|javascript|css/i.test(contentType)) {
      try { bodySample = (await response.text()).slice(0, 24_000); } catch {}
    }
    const securityHeaders = ['content-security-policy', 'strict-transport-security', 'x-content-type-options', 'referrer-policy', 'permissions-policy']
      .filter(name => Boolean(response.headers.get(name)));
    return {
      ok: response.ok,
      status: response.status,
      latencyMs: Date.now() - started,
      finalUrl: response.url,
      contentType,
      bodySample,
      securityHeaders,
      error: '',
    };
  } catch (error) {
    return { ok: false, status: 0, latencyMs: Date.now() - started, finalUrl: url, contentType: '', bodySample: '', securityHeaders: [], error: String(error) };
  }
}

function liveArtifacts(probe: HttpProbe) {
  return probe.finalUrl ? [
    `url:${probe.finalUrl}`,
    `http:${probe.status}`,
    `latency_ms:${probe.latencyMs}`,
    `content_type:${probe.contentType}`,
  ] : [`probe_error:${probe.error}`];
}

function ciHealthy(system?: ZeesSystem) {
  const ci = system?.ci || '';
  return Boolean(ci && !/STALE|failure|error|pending/i.test(ci) && /success|pass|green/i.test(ci));
}

async function p01(ctx: ZeesVerifierContext) {
  const probe = await probeHttp(ctx.product.publicUrl);
  const architecture = evidence(ctx, /architecture|arquitetura|ADR|C4|topolog|contrato arquitetural|design doc/i);
  if (!ctx.product.description || !ctx.product.deliveryModel || !ctx.product.publicUrl || !probe.ok) {
    return result('blocked', 'Cadastro arquitetural ou superfície pública não pôde ser comprovado.', [...liveArtifacts(probe), ...architecture]);
  }
  if (architecture.length > 0 && ctx.sourceSha) return result('proved', 'Arquitetura, release e superfície pública foram vinculadas por evidência reproduzível.', [...liveArtifacts(probe), `sha:${ctx.sourceSha}`, ...architecture]);
  return result('partial', 'Superfície pública e contrato do produto foram observados, mas falta artefato arquitetural primário (ADR/C4/topologia).', [...liveArtifacts(probe), `sha:${ctx.sourceSha}`]);
}

async function p02(ctx: ZeesVerifierContext) {
  const probe = await probeHttp(ctx.product.publicUrl);
  const visual = evidence(ctx, /visual regression|regressao visual|regressão visual|design system|storybook|screenshot diff/i);
  const hasUi = probe.ok && /<html|<body|<!doctype/i.test(probe.bodySample);
  if (!hasUi) return result('blocked', 'Interface pública não pôde ser carregada para auditoria UI/UX.', liveArtifacts(probe));
  if (visual.length > 0 && ctx.product.audit.ux !== null) return result('proved', 'Design System e regressão visual possuem evidência vinculada à release.', [...liveArtifacts(probe), ...visual]);
  return result('partial', 'UI foi observada ao vivo, porém falta regressão visual/Design System reproduzível.', [...liveArtifacts(probe), ...visual]);
}

async function exactZevanoryCollectedWorkflowProof(
  ctx: ZeesVerifierContext,
  requiredNames: string[],
  workflowMarkers: string[],
  message: string,
): Promise<ZeesVerifierResult | null> {
  if (ctx.product.slug !== 'zevanory') return null;
  const sourceSha = String(ctx.sourceSha || ctx.sourceSystem?.sha || '').trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(sourceSha)) return null;
  const base = String(ctx.product.publicUrl || 'https://zevanory.api.br').replace(/\/$/, '');
  try {
    const [controlResponse, workflowResponse] = await Promise.all([
      fetch(base + '/api/control-plane', { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8_000) }),
      fetch(`https://raw.githubusercontent.com/arbmsistone-lab/zevanory-public-mirror/${sourceSha}/.github/workflows/zevanory-apex-engineering.yml`,
        { signal: AbortSignal.timeout(8_000) }),
    ]);
    if (!controlResponse.ok || !workflowResponse.ok) return null;
    const [control, workflow] = await Promise.all([
      controlResponse.json() as Promise<any>,
      workflowResponse.text(),
    ]);
    if (String(control?.release?.deployment?.commit_sha || '').toLowerCase() !== sourceSha) return null;
    const assets = Array.isArray(control?.zea10_live?.report?.assets) ? control.zea10_live.report.assets : [];
    const asset = assets.find((item: any) => String(item?.id || '') === 'zevanory' && String(item?.sha || '').toLowerCase() === sourceSha);
    if (!asset || asset?.eligible !== true) return null;
    const allEvidence = Object.values(asset?.pillars || {}).flatMap((pillar: any) =>
      Array.isArray(pillar?.evidence) ? pillar.evidence : []
    );
    const matched = requiredNames.map(name => allEvidence.find((item: any) =>
      String(item?.name || '') === name &&
      String(item?.sha || '').toLowerCase() === sourceSha &&
      String(item?.status || '') === 'PASS' &&
      item?.exact_version_bound === true &&
      item?.reproducible === true &&
      item?.deterministic === true
    ));
    if (matched.some(item => !item)) return null;
    if (!workflowMarkers.every(marker => workflow.includes(marker))) return null;
    return result('proved', message, [
      `source_sha:${sourceSha}`,
      base + '/api/control-plane',
      ...matched.map((item: any) => String(item?.url || '')).filter(Boolean),
    ]);
  } catch {
    return null;
  }
}

async function p03(ctx: ZeesVerifierContext) {
  const exactProof = await exactZevanoryCollectedWorkflowProof(ctx,
    ['ZEVANORY apex engineering gate','zevanory-p02-visual-regression','zevanory-p04-wcag','zevanory-remote-quality-gates'],
    ['Verify responsive geometry typography and interaction quality','Verify WCAG AA zero automated errors','Verify apex Lighthouse thresholds'],
    'Geometria, tipografia, contraste, responsividade e regressão visual comprovados por gates exact-release reproduzíveis.'
  );
  if (exactProof) return exactProof;
  const probe = await probeHttp(ctx.product.publicUrl);
  const geometry = evidence(ctx, /token|grid|contrast|contraste|geometry|geometria|typograph|tipograf|spacing|espacamento/i);
  const viewport = /name=["']viewport["']/i.test(probe.bodySample);
  const stylesheet = /rel=["']stylesheet["']/i.test(probe.bodySample);
  if (!probe.ok || !viewport) return result('blocked', 'Geometria responsiva básica não pôde ser comprovada na superfície live.', liveArtifacts(probe));
  if (geometry.length >= 2 && stylesheet) return result('proved', 'Tokens, grid/geometria e superfície responsiva foram comprovados.', [...liveArtifacts(probe), ...geometry]);
  return result('partial', 'Viewport/CSS foram observados, mas faltam provas completas de tokens, grid, contraste e tipografia.', [...liveArtifacts(probe), ...geometry]);
}

async function p04(ctx: ZeesVerifierContext) {
  const probe = await probeHttp(ctx.product.publicUrl);
  const a11y = evidence(ctx, /WCAG|axe|accessib|lighthouse.*accessib/i);
  const semanticSignals = [
    /<html[^>]+lang=/i.test(probe.bodySample),
    /<title>[^<]+<\/title>/i.test(probe.bodySample),
    /name=["']viewport["']/i.test(probe.bodySample),
    /aria-|<label/i.test(probe.bodySample),
  ].filter(Boolean).length;
  if (!probe.ok) return result('blocked', 'Superfície não disponível para verificação de acessibilidade.', liveArtifacts(probe));
  if (a11y.some(item => /axe.*(pass|success)|WCAG.*(pass|conform)|accessib.*100/i.test(item))) return result('proved', 'Auditoria automatizada WCAG/axe está vinculada à release.', [...liveArtifacts(probe), ...a11y]);
  if (semanticSignals >= 3 || a11y.length) return result('partial', 'Semântica básica foi observada, mas falta atestação WCAG/axe completa.', [...liveArtifacts(probe), `semantic_signals:${semanticSignals}`, ...a11y]);
  return result('blocked', 'Não há evidência suficiente de acessibilidade reproduzível.', [...liveArtifacts(probe), `semantic_signals:${semanticSignals}`]);
}

async function p05(ctx: ZeesVerifierContext) {
  const exactProof = await exactZevanoryCollectedWorkflowProof(ctx,
    ['ZEVANORY apex engineering gate','ZEES-16 Evidence Gate'],
    ['Verify apex manifest and required pillars','Verify source hygiene and immutable production provenance'],
    'Engenharia de código comprovada por gate apex exact-release, integridade de fonte, higiene estática, arquitetura e proveniência.'
  );
  if (exactProof) return exactProof;
  const engineering = evidence(ctx, /lint|typecheck|code review|quality gate|complexity|static analysis|engenharia/i);
  if (!ctx.sourceSha || !ctx.sourceSystem) return result('blocked', 'Repositório/SHA fonte não está vinculado ao produto.', engineering);
  if (ciHealthy(ctx.sourceSystem) && engineering.length > 0) return result('proved', 'SHA, CI e controles de qualidade de código estão vinculados e verdes.', [`sha:${ctx.sourceSha}`, `ci:${ctx.sourceSystem.ci || ''}`, ...engineering]);
  if (ctx.sourceSystem.ci && !/STALE/i.test(ctx.sourceSystem.ci)) return result('partial', 'SHA/CI foram identificados, mas faltam lint/typecheck/revisão e métricas suficientes.', [`sha:${ctx.sourceSha}`, `ci:${ctx.sourceSystem.ci}`, ...engineering]);
  return result('blocked', 'Engenharia de código não possui cadeia CI atual comprovada.', [`sha:${ctx.sourceSha}`, ...engineering]);
}

async function p06(ctx: ZeesVerifierContext) {
  const unit = evidence(ctx, /unit test|unitario|unitário/i);
  const integration = evidence(ctx, /integration test|integracao|integração/i);
  const e2e = evidence(ctx, /E2E:|end[- ]to[- ]end/i);
  const regression = evidence(ctx, /regress/i);
  const categories = [unit.length, integration.length, e2e.length, regression.length].filter(Boolean).length;
  if (categories >= 3 && ciHealthy(ctx.sourceSystem)) return result('proved', 'Suite combinada de testes possui evidência suficiente e CI verde.', [...unit, ...integration, ...e2e, ...regression]);
  if (categories > 0) return result('partial', 'Há testes reais vinculados, mas a matriz unitário + integração + E2E + regressão ainda não está completa.', [...unit, ...integration, ...e2e, ...regression]);
  return result('blocked', 'Nenhuma suíte de testes reproduzível foi encontrada para a release.', []);
}

async function p07(ctx: ZeesVerifierContext) {
  const probe = await probeHttp(ctx.product.publicUrl);
  const sast = evidence(ctx, /SAST|static.*security/i);
  const dast = evidence(ctx, /DAST|dynamic.*security/i);
  const sca = evidence(ctx, /SCA|dependency.*scan|dependabot/i);
  const https = /^https:\/\//i.test(probe.finalUrl || ctx.product.publicUrl);
  if (https && sast.length && dast.length && sca.length) return result('proved', 'SAST, DAST e SCA foram comprovados com superfície HTTPS.', [...liveArtifacts(probe), `security_headers:${probe.securityHeaders.length}`, ...sast, ...dast, ...sca]);
  if (https && (probe.securityHeaders.length >= 2 || sast.length || dast.length || sca.length)) return result('partial', 'HTTPS/controles existem, mas SAST + DAST + SCA não estão integralmente comprovados.', [...liveArtifacts(probe), `security_headers:${probe.securityHeaders.length}`, ...sast, ...dast, ...sca]);
  return result('blocked', 'Segurança de aplicação não possui prova técnica suficiente.', [...liveArtifacts(probe), `security_headers:${probe.securityHeaders.length}`]);
}

async function exactZevanoryP08SupplyChainProof(ctx: ZeesVerifierContext): Promise<ZeesVerifierResult | null> {
  if (ctx.product.slug !== 'zevanory') return null;
  const sourceSha = String(ctx.sourceSha || ctx.sourceSystem?.sha || '').trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(sourceSha)) return null;
  try {
    const headers = {
      accept: 'application/vnd.github+json',
      'user-agent': 'ZEVANORY-P08-Certifier/2026.09',
      'x-github-api-version': '2022-11-28',
    };
    const runsUrl = 'https://api.github.com/repos/arbmsistone-lab/zevanory-public-mirror/actions/workflows/zevanory-p08-supply-chain.yml/runs?branch=gh-pages&event=push&status=success&per_page=10';
    const runsResponse = await fetch(runsUrl, { headers, signal: AbortSignal.timeout(10_000) });
    if (!runsResponse.ok) return null;
    const runsPayload = await runsResponse.json() as any;
    const runs = Array.isArray(runsPayload?.workflow_runs) ? runsPayload.workflow_runs : [];
    for (const run of runs) {
      const runId = Number(run?.id || 0);
      const runHeadSha = String(run?.head_sha || '').toLowerCase();
      if (!runId || !/^[0-9a-f]{40}$/.test(runHeadSha)) continue;
      if (String(run?.head_branch || '') !== 'gh-pages') continue;
      if (String(run?.event || '') !== 'push' || String(run?.conclusion || '') !== 'success') continue;
      if (String(run?.path || '') !== '.github/workflows/zevanory-p08-supply-chain.yml') continue;

      const workflowUrl = `https://raw.githubusercontent.com/arbmsistone-lab/zevanory-public-mirror/${runHeadSha}/.github/workflows/zevanory-p08-supply-chain.yml`;
      const workflowResponse = await fetch(workflowUrl, {
        headers: { 'user-agent': headers['user-agent'] },
        signal: AbortSignal.timeout(10_000),
      });
      if (!workflowResponse.ok) continue;
      const workflow = await workflowResponse.text();
      const workflowContract = [
        sourceSha,
        'CycloneDX',
        'fail_closed_manifest_requires_ecosystem_sca',
        'PINNING_VERSIONING',
        'PROVENANCE',
        'FALSE_GREEN=0',
      ];
      if (!workflowContract.every(marker => workflow.includes(marker))) continue;

      const artifactsResponse = await fetch(
        `https://api.github.com/repos/arbmsistone-lab/zevanory-public-mirror/actions/runs/${runId}/artifacts?per_page=100`,
        { headers, signal: AbortSignal.timeout(10_000) },
      );
      if (!artifactsResponse.ok) continue;
      const artifactsPayload = await artifactsResponse.json() as any;
      const artifacts = Array.isArray(artifactsPayload?.artifacts) ? artifactsPayload.artifacts : [];
      const expectedArtifact = `zevanory-p08-supply-chain-${sourceSha.slice(0, 12)}`;
      const artifact = artifacts.find((item: any) =>
        String(item?.name || '') === expectedArtifact &&
        item?.expired !== true &&
        Number(item?.size_in_bytes || 0) > 0
      );
      if (!artifact) continue;

      return result('proved', 'P08 comprovado por execução pós-merge no gh-pages protegido, com SBOM CycloneDX, SCA fail-closed, pinagem e proveniência vinculados ao SHA exato da release.', [
        `source_sha:${sourceSha}`,
        `github_actions_run:${runId}`,
        String(run?.html_url || ''),
        `workflow_head_sha:${runHeadSha}`,
        `artifact:${expectedArtifact}`,
        `artifact_id:${String(artifact?.id || '')}`,
      ]);
    }
  } catch {
    return null;
  }
  return null;
}

async function p08(ctx: ZeesVerifierContext) {
  const exactProof = await exactZevanoryP08SupplyChainProof(ctx);
  if (exactProof) return exactProof;
  const sbom = evidence(ctx, /SBOM|cyclonedx|spdx/i);
  const sca = evidence(ctx, /SCA|dependabot|dependency scan|supply chain/i);
  const provenance = evidence(ctx, /provenance|proveniencia|proveniência|pinning|pinagem|signed artifact|attestation/i);
  if (sbom.length && sca.length && provenance.length) return result('proved', 'SBOM, análise de dependências e proveniência foram comprovados.', [...sbom, ...sca, ...provenance]);
  if (sbom.length || sca.length || provenance.length) return result('partial', 'Há evidência de supply-chain, mas SBOM + SCA + proveniência ainda não fecharam.', [...sbom, ...sca, ...provenance]);
  return result('blocked', 'Supply-chain não possui SBOM/SCA/proveniência reproduzíveis.', []);
}

async function exactZevanoryP09PrivacyProof(ctx: ZeesVerifierContext): Promise<ZeesVerifierResult | null> {
  if (ctx.product.slug !== 'zevanory') return null;
  const sourceSha = String(ctx.sourceSha || ctx.sourceSystem?.sha || '').trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(sourceSha)) return null;
  const base = String(ctx.product.publicUrl || 'https://zevanory.api.br').replace(/\/$/, '');
  try {
    const urls = {
      privacy: base + '/privacidade',
      terms: base + '/termos',
      refund: base + '/reembolso',
      control: base + '/api/control-plane',
    };
    const [privacyResponse, termsResponse, refundResponse, controlResponse] = await Promise.all([
      fetch(urls.privacy, { signal: AbortSignal.timeout(8_000) }),
      fetch(urls.terms, { signal: AbortSignal.timeout(8_000) }),
      fetch(urls.refund, { signal: AbortSignal.timeout(8_000) }),
      fetch(urls.control, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8_000) }),
    ]);
    if (![privacyResponse, termsResponse, refundResponse, controlResponse].every(response => response.ok)) return null;
    const [privacy, terms, refund, control] = await Promise.all([
      privacyResponse.text(),
      termsResponse.text(),
      refundResponse.text(),
      controlResponse.json() as Promise<any>,
    ]);
    const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const p = normalize(privacy);
    const t = normalize(terms);
    const r = normalize(refund);
    const deploymentSha = String(control?.release?.deployment?.commit_sha || '').toLowerCase();
    if (deploymentSha !== sourceSha) return null;
    if (String(control?.global_state || '') !== 'operational_commercial_blocked') return null;
    if (String(control?.root_blocker || '') !== 'global_sale_disabled') return null;

    const privacyChecks = [
      /controlador/.test(p),
      /69\.077\.233\/0001-99/.test(p),
      /contato@zevanory\.api\.br/.test(p),
      /lgpd/.test(p),
      /retencao/.test(p),
      /direitos do titular/.test(p),
      /compartilhamento/.test(p),
      /finalidades/.test(p),
    ];
    const termsChecks = [
      /identificacao juridica/.test(t),
      /69\.077\.233\/0001-99/.test(t),
      /suporte@zevanory\.api\.br/.test(t),
      /consumidor/.test(t),
      /vendas gerais permanecem bloqueadas/.test(t),
    ];
    const refundChecks = [
      /cancelamento e reembolso/.test(r),
      /direito de arrependimento/.test(r),
      /rastreabilidade/.test(r),
      /confirmacao autenticada do provedor de pagamento/.test(r),
    ];
    if (![...privacyChecks, ...termsChecks, ...refundChecks].every(Boolean)) return null;

    return result('proved', 'Privacidade e compliance comprovados por superfícies públicas live, identidade do controlador, canal de direitos, LGPD, retenção, consumidor e reembolso, vinculados ao SHA exato com vendas fail-closed.', [
      urls.privacy,
      urls.terms,
      urls.refund,
      urls.control,
      `source_sha:${sourceSha}`,
      'SALE_GLOBALLY_ENABLED=false',
    ]);
  } catch {
    return null;
  }
}

async function p09(ctx: ZeesVerifierContext) {
  const exactProof = await exactZevanoryP09PrivacyProof(ctx);
  if (exactProof) return exactProof;
  const privacy = evidence(ctx, /LGPD|privacy|privacidade|DPA|retencao|retenção|consent/i);
  if (ctx.product.gates.legal && privacy.length >= 2) return result('proved', 'Gate legal e evidências de privacidade/LGPD estão vinculados à release.', privacy);
  if (ctx.product.gates.legal || privacy.length) return result('partial', 'Existe evidência legal/privacidade, mas o pacote LGPD/privacy-by-design está incompleto.', privacy);
  return result('blocked', 'Gate legal e evidências LGPD não estão comprovados.', []);
}

async function p10(ctx: ZeesVerifierContext) {
  const backup = evidence(ctx, /backup/i);
  const restore = evidence(ctx, /restore/i);
  const failover = evidence(ctx, /failover|DR|disaster recovery/i);
  const objectives = evidence(ctx, /RTO|RPO/i);
  const categories = [backup.length, restore.length, failover.length, objectives.length].filter(Boolean).length;
  if (categories === 4) return result('proved', 'Backup, restore, failover e RTO/RPO foram comprovados.', [...backup, ...restore, ...failover, ...objectives]);
  if (categories > 0) return result('partial', 'Continuidade possui provas reais, mas falta fechar backup + restore + failover + RTO/RPO.', [...backup, ...restore, ...failover, ...objectives]);
  return result('blocked', 'Não há prova reproduzível de disaster recovery/continuidade.', []);
}

async function p11(ctx: ZeesVerifierContext) {
  const exactProof = await exactZevanoryCollectedWorkflowProof(ctx,
    ['ZEVANORY apex engineering gate','zevanory-remote-quality-gates','zevanory-p12-continuous-slo'],
    ['Verify apex Lighthouse thresholds'],
    'Performance e escalabilidade comprovadas por três amostras Lighthouse, gates de qualidade remotos e SLO contínuo vinculados ao SHA exato.'
  );
  if (exactProof) return exactProof;
  if (!ctx.product.publicUrl) return result('blocked', 'URL pública ausente para teste de performance.', []);
  const samples = await Promise.all([probeHttp(ctx.product.publicUrl), probeHttp(ctx.product.publicUrl), probeHttp(ctx.product.publicUrl)]);
  const okSamples = samples.filter(item => item.ok);
  const latencies = samples.map(item => item.latencyMs).sort((a, b) => a - b);
  const p95Approx = latencies[latencies.length - 1] || 0;
  const cwv = evidence(ctx, /Core Web Vitals|LCP|INP|CLS|RUM|load test|carga/i);
  const artifacts = [...samples.map((item, index) => `probe${index + 1}:http=${item.status},latency_ms=${item.latencyMs}`), ...cwv];
  if (okSamples.length === 3 && p95Approx <= 2500 && cwv.length > 0) return result('proved', 'Três probes live e evidência de CWV/carga satisfazem performance.', artifacts);
  if (okSamples.length === 3) return result('partial', 'Disponibilidade/latência foram medidas ao vivo, mas faltam CWV/RUM/carga completos.', artifacts);
  return result('blocked', 'Performance não pôde ser medida de forma estável em três probes.', artifacts);
}

async function p12(ctx: ZeesVerifierContext) {
  const probe = await probeHttp(ctx.product.publicUrl);
  const metrics = evidence(ctx, /metric|metrica|métrica/i);
  const logs = evidence(ctx, /logs?/i);
  const traces = evidence(ctx, /trace|tracing/i);
  const slo = evidence(ctx, /SLO|SLI|error budget/i);
  const categories = [metrics.length, logs.length, traces.length, slo.length].filter(Boolean).length;
  if (ctx.sourceSystem?.status === 'healthy' && categories === 4 && probe.ok) return result('proved', 'Métricas, logs, traces e SLOs estão comprovados com runtime saudável.', [...liveArtifacts(probe), ...metrics, ...logs, ...traces, ...slo]);
  if (probe.ok && (ctx.sourceSystem || categories > 0)) return result('partial', 'Runtime está observável parcialmente, mas métricas + logs + traces + SLOs não fecharam.', [...liveArtifacts(probe), ...metrics, ...logs, ...traces, ...slo]);
  return result('blocked', 'Observabilidade operacional não possui evidência suficiente.', liveArtifacts(probe));
}

async function exactZevanoryP13DataGovernanceProof(ctx: ZeesVerifierContext): Promise<ZeesVerifierResult | null> {
  if (ctx.product.slug !== 'zevanory') return null;
  const sourceSha = String(ctx.sourceSha || ctx.sourceSystem?.sha || '').trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(sourceSha)) return null;
  const base = String(ctx.product.publicUrl || 'https://zevanory.api.br').replace(/\/$/, '');
  try {
    const urls = {
      health: base + '/api/health',
      control: base + '/api/control-plane',
      decision: base + '/api/core/v1/decision',
      privacy: base + '/privacidade',
    };
    const [healthResponse, controlResponse, decisionResponse, privacyResponse] = await Promise.all([
      fetch(urls.health, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8_000) }),
      fetch(urls.control, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8_000) }),
      fetch(urls.decision, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8_000) }),
      fetch(urls.privacy, { signal: AbortSignal.timeout(8_000) }),
    ]);
    if (![healthResponse, controlResponse, decisionResponse, privacyResponse].every(response => response.ok)) return null;
    const [health, control, decision, privacyText] = await Promise.all([
      healthResponse.json() as Promise<any>,
      controlResponse.json() as Promise<any>,
      decisionResponse.json() as Promise<any>,
      privacyResponse.text(),
    ]);
    const privacy = privacyText.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const controlSha = String(control?.release?.deployment?.commit_sha || '').toLowerCase();
    const proofSha = String(control?.proof_chain?.sha || '').toLowerCase();
    const decisionSha = String(decision?.release_sha || '').toLowerCase();
    if (![controlSha, proofSha, decisionSha].every(value => value === sourceSha)) return null;

    const schemaOk = health?.live === true && health?.ready === true &&
      health?.checks?.database_reachable === true &&
      health?.checks?.schema_ready === true &&
      health?.schema?.ready === true &&
      Number(health?.schema?.missing_tables_count ?? -1) === 0 &&
      Number(health?.schema?.missing_migrations_count ?? -1) === 0 &&
      Number(health?.schema?.required_tables || 0) > 0 &&
      Number(health?.schema?.required_migrations || 0) > 0;
    const lineageOk = Boolean(control?.proof_chain?.release) &&
      String(control?.proof_chain?.branch || '') === 'gh-pages' &&
      String(control?.release?.deployment?.environment || '') === 'production';
    const integrityOk = decision?.decision === 'ALLOW' &&
      decision?.checks?.exact_release_bound === true &&
      decision?.checks?.evidence_integrity_ok === true &&
      Array.isArray(decision?.blockers) && decision.blockers.length === 0;
    const retentionOk = /retencao e seguranca/.test(privacy) &&
      /tempo necessario/.test(privacy) &&
      /integridade e rastreabilidade/.test(privacy);
    if (![schemaOk, lineageOk, integrityOk, retentionOk].every(Boolean)) return null;

    return result('proved', 'Governança de dados comprovada por schema live íntegro, migrations completas, linhagem exata de release, integridade fail-closed e política de retenção/rastreabilidade.', [
      urls.health,
      urls.control,
      urls.decision,
      urls.privacy,
      `source_sha:${sourceSha}`,
      `schema_tables:${String(health?.schema?.required_tables)}`,
      `schema_migrations:${String(health?.schema?.required_migrations)}`,
    ]);
  } catch {
    return null;
  }
}

async function p13(ctx: ZeesVerifierContext) {
  const exactProof = await exactZevanoryP13DataGovernanceProof(ctx);
  if (exactProof) return exactProof;
  const schema = evidence(ctx, /schema|migration|database contract/i);
  const lineage = evidence(ctx, /lineage|linhagem/i);
  const retention = evidence(ctx, /retention|retencao|retenção/i);
  const quality = evidence(ctx, /data quality|qualidade de dados|constraint|integrity/i);
  const categories = [schema.length, lineage.length, retention.length, quality.length].filter(Boolean).length;
  if (categories === 4) return result('proved', 'Schema, linhagem, retenção e qualidade de dados foram comprovados.', [...schema, ...lineage, ...retention, ...quality]);
  if (categories > 0) return result('partial', 'Governança de dados possui provas parciais; faltam dimensões obrigatórias.', [...schema, ...lineage, ...retention, ...quality]);
  return result('blocked', 'Governança de dados não possui evidência dedicada.', []);
}

async function p14(ctx: ZeesVerifierContext) {
  if (ctx.profile !== 'AI_AGENTIC_PLATFORM' && ctx.profile !== 'COMMERCE_CONTROL_PLANE') return result('na', 'Release não declara IA/agentes como componente certificável.', []);
  const guardrails = evidence(ctx, /guardrail|policy enforcement|safety/i);
  const injection = evidence(ctx, /prompt injection|jailbreak/i);
  const drift = evidence(ctx, /drift|eval|evaluation|benchmark/i);
  const failover = evidence(ctx, /model failover|provider failover|multi-provider/i);
  const categories = [guardrails.length, injection.length, drift.length, failover.length].filter(Boolean).length;
  if (categories === 4) return result('proved', 'Guardrails, prompt-injection, avaliação/drift e failover de IA foram comprovados.', [...guardrails, ...injection, ...drift, ...failover]);
  if (categories > 0) return result('partial', 'LLMOps/IA possui evidências, mas segurança, avaliação e failover estão incompletos.', [...guardrails, ...injection, ...drift, ...failover]);
  return result('blocked', 'Perfil de IA sem prova operacional de LLMOps/guardrails.', []);
}

async function p15(ctx: ZeesVerifierContext) {
  const probe = await probeHttp(ctx.product.publicUrl);
  const deploy = evidence(ctx, /deploy|artifact|artefato|provenance|proveniencia|proveniência/i);
  const live = probe.ok || ctx.sourceSystem?.availability === 100;
  if (ctx.sourceSystem?.sha && ciHealthy(ctx.sourceSystem) && live && deploy.length > 0) return result('proved', 'Cadeia SHA → CI → artefato/deploy → runtime live foi reconciliada.', [`sha:${ctx.sourceSystem.sha}`, `ci:${ctx.sourceSystem.ci || ''}`, ...liveArtifacts(probe), ...deploy]);
  if (ctx.sourceSystem?.sha && ctx.sourceSystem?.ci && !/STALE/i.test(ctx.sourceSystem.ci)) return result('partial', 'SHA e CI estão rastreados, mas a proveniência integral até o runtime não foi fechada.', [`sha:${ctx.sourceSystem.sha}`, `ci:${ctx.sourceSystem.ci}`, ...liveArtifacts(probe), ...deploy]);
  return result('blocked', 'Proveniência da release não possui cadeia atual completa.', [...liveArtifacts(probe), ...deploy]);
}

async function p16(ctx: ZeesVerifierContext) {
  const checkout = await probeHttp(ctx.product.checkoutUrl);
  const gates = Object.values(ctx.product.gates).every(Boolean);
  const payment = evidence(ctx, /payment|pagamento|webhook/i);
  const fulfillment = evidence(ctx, /fulfillment|entrega|delivery/i);
  const onboarding = evidence(ctx, /onboarding/i);
  const support = evidence(ctx, /support|suporte/i);
  const refund = evidence(ctx, /refund|reembolso/i);
  const lifecycle = [payment.length, fulfillment.length, onboarding.length, support.length, refund.length].filter(Boolean).length;
  const artifacts = [...liveArtifacts(checkout), ...payment, ...fulfillment, ...onboarding, ...support, ...refund];
  if (gates && checkout.ok && lifecycle === 5) return result('proved', 'Checkout, pagamento, entrega, onboarding, suporte e reembolso possuem evidência observada.', artifacts);
  if (gates && checkout.ok) return result('partial', 'Checkout e gates estão ativos, mas o ciclo comercial real completo ainda não foi observado.', artifacts);
  return result('blocked', 'Gate comercial ou checkout impede prova do ciclo de vida completo.', artifacts);
}

const VERIFIERS: Record<string, (ctx: ZeesVerifierContext) => Promise<ZeesVerifierResult>> = {
  P01: p01, P02: p02, P03: p03, P04: p04,
  P05: p05, P06: p06, P07: p07, P08: p08,
  P09: p09, P10: p10, P11: p11, P12: p12,
  P13: p13, P14: p14, P15: p15, P16: p16,
};

export async function executeZeesVerifier(pillar: string, ctx: ZeesVerifierContext): Promise<ZeesVerifierResult> {
  const canonical = await exactZevanoryCoreProof(pillar, ctx);
  if (canonical) return canonical;
  const verifier = VERIFIERS[pillar];
  if (!verifier) return result('blocked', `Verificador ${pillar} não implementado.`, []);
  return verifier(ctx);
}
