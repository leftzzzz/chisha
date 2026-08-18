import { configureCloudflareAgentSessionStore } from '@/lib/agent/cloudflareSessionStore';
import {
  deleteAgentSessionAsync,
  getAgentSessionAsync,
  saveAgentSessionAsync,
} from '@/lib/agent/session';
import {
  claimLegacySessionOwner,
  getSessionOwner,
  sessionBelongsToOwner,
  SessionOwnerConfigurationError,
} from '@/lib/agent/sessionOwner';
import { checkRateLimit, getClientIP } from '@/lib/rateLimit';
import {
  acquireProviderLease,
  getProviderSchedulerConfig,
  providerSchedulerName,
  ProviderSchedulerError,
  type ProviderLease,
} from '@/lib/providerScheduler';

interface RouteContext {
  params: Promise<{ id: string }> | { id: string };
}

export async function GET(request: Request, context: RouteContext) {
  await configureCloudflareAgentSessionStore();

  const limit = await checkRateLimit('agentSessionPerIp', getClientIP(request));
  if (!limit.success) {
    return jsonResponse({ error: '请求过于频繁，请稍后再试' }, 429, {
      'Retry-After': String(limit.retryAfterSeconds),
    });
  }

  let ownerContext: Awaited<ReturnType<typeof getSessionOwner>>;
  try {
    ownerContext = await getSessionOwner(request);
  } catch (error) {
    if (error instanceof SessionOwnerConfigurationError) {
      return jsonResponse({ error: '服务配置不完整' }, 503, { 'Retry-After': '30' });
    }
    throw error;
  }

  const { id } = await context.params;
  const session = await getAgentSessionAsync(id);

  if (!session || !sessionBelongsToOwner(session.ownerId, ownerContext.ownerId)) {
    return jsonResponse({ error: 'Session not found' }, 404);
  }
  if (claimLegacySessionOwner(session, ownerContext.ownerId)) {
    await saveAgentSessionAsync(session);
  }

  // trace 默认不返回（体积大），排障时用 ?include=trace 显式取。
  const includeTrace = new URL(request.url).searchParams.get('include') === 'trace';

  return jsonResponse({
    id: session.id,
    version: session.version,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    expiresAt: session.expiresAt,
    pendingQuestion: session.pendingQuestion,
    goal: session.goal
      ? {
          rawQuery: session.goal.rawQuery,
          primaryKeywords: session.goal.primaryKeywords,
          requestedItems: session.goal.requestedItems,
          acceptableCategories: session.goal.acceptableCategories,
          allowBroaden: session.goal.allowBroaden,
        }
      : undefined,
    actionCount: session.actions.length,
    observationCount: session.observations.length,
    traceCount: session.trace.length,
    ...(includeTrace ? { trace: session.trace } : {}),
    actions: session.actions.map((action) => ({
      id: action.id,
      type: action.action.type,
      summary: action.summary,
      createdAt: action.createdAt,
    })),
    observations: session.observations.map((observation) => ({
      actionId: observation.actionId,
      keywords: observation.plan.keywords,
      searchIntent: observation.plan.searchIntent,
      rawCount: observation.rawCount,
      acceptedPrimaryCount: observation.acceptedPrimaryIds.length,
      candidateCount: observation.candidateIds.length,
      hardRejectedCount: observation.hardRejected.length,
      unmetConstraints: observation.unmetConstraints.slice(0, 5),
    })),
  }, 200, ownerContext.setCookie ? { 'Set-Cookie': ownerContext.setCookie } : {});
}

export async function DELETE(request: Request, context: RouteContext) {
  await configureCloudflareAgentSessionStore();

  const limit = await checkRateLimit('agentSessionPerIp', getClientIP(request));
  if (!limit.success) {
    return jsonResponse({ error: '请求过于频繁，请稍后再试' }, 429, {
      'Retry-After': String(limit.retryAfterSeconds),
    });
  }

  let ownerContext: Awaited<ReturnType<typeof getSessionOwner>>;
  try {
    ownerContext = await getSessionOwner(request);
  } catch (error) {
    if (error instanceof SessionOwnerConfigurationError) {
      return jsonResponse({ error: '服务配置不完整' }, 503, { 'Retry-After': '30' });
    }
    throw error;
  }

  const { id } = await context.params;
  const session = await getAgentSessionAsync(id);
  if (!session || !sessionBelongsToOwner(session.ownerId, ownerContext.ownerId)) {
    return jsonResponse({ error: 'Session not found' }, 404);
  }

  let sessionLease: ProviderLease | undefined;
  try {
    sessionLease = await acquireProviderLease(
      providerSchedulerName('session', id),
      getProviderSchedulerConfig('session'),
      { signal: request.signal }
    );
    await deleteAgentSessionAsync(id);
    return jsonResponse(
      { ok: true },
      200,
      ownerContext.setCookie ? { 'Set-Cookie': ownerContext.setCookie } : {}
    );
  } catch (error) {
    if (error instanceof ProviderSchedulerError) {
      const status = error.kind === 'busy' || error.kind === 'blocked' ? 429 : 503;
      return jsonResponse(
        { error: status === 429 ? '会话正在处理中，请稍后重试' : '服务暂时不可用' },
        status,
        {
          'Retry-After': String(Math.max(1, Math.ceil(error.retryAfterMs / 1000))),
          ...(ownerContext.setCookie ? { 'Set-Cookie': ownerContext.setCookie } : {}),
        }
      );
    }
    throw error;
  } finally {
    await Promise.allSettled([sessionLease?.release()]);
  }
}

function jsonResponse(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}
