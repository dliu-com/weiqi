// The CDK stack prepends the shared engine and game-service code to this handler.
const { DynamoDBClient, GetItemCommand, PutItemCommand, ScanCommand, TransactWriteItemsCommand } = require('@aws-sdk/client-dynamodb');
const db = new DynamoDBClient({});
const response = (statusCode, body) => ({
  statusCode,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  body: JSON.stringify(body),
});
async function readGame(key = 'current') {
  const data = await db.send(new GetItemCommand({
    TableName: process.env.TABLE_NAME,
    Key: { gameId: { S: key } },
    ConsistentRead: true,
  }));
  if (data.Item) return JSON.parse(data.Item.state.S);
  if (key !== 'current') throw new GameError('页面不存在。', 404);
  return createState();
}
exports.handler = async event => {
  const method = event.requestContext?.http?.method;
  const requestPath = event.rawPath;
  const archiveId = requestPath.startsWith('/api/games/') ? requestPath.slice('/api/games/'.length) : null;
  const key = archiveId ? 'archive#' + archiveId : 'current';
  if (requestPath !== '/api/game' && requestPath !== '/api/games' && !archiveId) return response(404, { message: '页面不存在。' });
  try {
    if (method === 'GET' && requestPath === '/api/games') {
      const cursor = event.queryStringParameters?.cursor;
      if (cursor && (!cursor.startsWith('archive#') && cursor !== 'current')) throw new GameError('请求格式无效。');
      const data = await db.send(new ScanCommand({
        TableName: process.env.TABLE_NAME, Limit: 50, ConsistentRead: true,
        ProjectionExpression: 'gameId, gameName, createdAt, updatedAt',
        ...(cursor ? { ExclusiveStartKey: { gameId: { S: cursor } } } : {}),
      }));
      return response(200, { games: (data.Items || []).filter(i => i.gameId.S.startsWith('archive#')).map(i => ({
        id: i.gameId.S.slice(8), gameName: i.gameName?.S || null, createdAt: i.createdAt?.S, updatedAt: i.updatedAt?.S
      })), cursor: data.LastEvaluatedKey?.gameId.S || null });
    }
    if (method === 'GET') return response(200, { state: await readGame(key) });
    if (requestPath === '/api/games') return response(405, { message: '不支持此请求方法。' });
    if (method !== 'POST') return response(405, { message: '不支持此请求方法。' });
    const headers = event.headers || {};
    if (headers.origin && headers.origin !== process.env.SITE_ORIGIN) return response(403, { message: '请求来源无效。' });
    if (!headers['content-type']?.toLowerCase().startsWith('application/json')) return response(415, { message: '请使用 JSON 格式。' });
    const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : event.body || '';
    if (Buffer.byteLength(raw) > 2048) return response(413, { message: '请求过大。' });
    let request;
    try { request = JSON.parse(raw); } catch { return response(400, { message: '请求格式无效。' }); }
    if (archiveId && !['rename','players','metadata'].includes(request.action?.type)) throw new GameError('当前棋局不能执行此操作。');
    const current = await readGame(key);
    const next = transition(current, request);
    const item = (id, state) => ({
      gameId: { S: id }, revision: { N: String(state.revision) }, state: { S: JSON.stringify(state) },
      gameName: { S: state.gameName || '' }, createdAt: { S: state.createdAt || state.updatedAt || next.updatedAt },
      updatedAt: { S: state.updatedAt || next.updatedAt },
    });
    const save = {
      TableName: process.env.TABLE_NAME, Item: item(key, next),
      ConditionExpression: 'attribute_not_exists(#revision) OR #revision = :expected',
      ExpressionAttributeNames: { '#revision': 'revision' },
      ExpressionAttributeValues: { ':expected': { N: String(current.revision) } },
    };
    if (request.action.type === 'new') {
      const archived = { ...current, clock: { ...gameClock(current), paused: true, since: null }, createdAt: current.createdAt || current.updatedAt || next.updatedAt, tree: gameTree(current) };
      await db.send(new TransactWriteItemsCommand({ TransactItems: [
        { Put: save },
        { Put: { TableName: process.env.TABLE_NAME, Item: item('archive#' + current.revision + '-' + Date.now(), archived), ConditionExpression: 'attribute_not_exists(gameId)' } },
      ] }));
    } else await db.send(new PutItemCommand(save));
    return response(200, { state: next });
  } catch (error) {
    if (error.name === 'ConditionalCheckFailedException' || error.name === 'TransactionCanceledException' || error.statusCode === 409) {
      return response(409, { message: '棋局已更新，已为你同步最新进度。', state: await readGame(key) });
    }
    if (error instanceof GameError) return response(error.statusCode, { message: error.message });
    console.error('Game API failed', { name: error.name, message: error.message });
    return response(500, { message: '棋局暂时无法同步，请稍后重试。' });
  }
};
