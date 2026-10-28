/**
 * Servidor MCP (Model Context Protocol) sobre JSON-RPC 2.0 — só ferramentas (tools) e sem estado:
 * cada mensagem é respondida sozinha, sem sessão (`Mcp-Session-Id`) nem fluxo do servidor para o
 * cliente. É o que o Claude (Claude Code, Claude Desktop) usa para descobrir e chamar as ferramentas.
 *
 * Puro: não conhece HTTP nem os casos de uso. Recebe o catálogo (`tools`, cada uma com `run(args,
 * context)`) e o contexto de quem chama; o transporte fica em http/mcp.js.
 */

const { appError, isAppError, toErrorPayload } = require('../core/errors')
const { validateArguments } = require('./schema')

/** Versões do protocolo aceitas, da mais recente para a mais antiga (transporte "Streamable HTTP"). */
const PROTOCOL_VERSIONS = Object.freeze(['2025-11-25', '2025-06-18', '2025-03-26'])

const RPC = Object.freeze({
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
})

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function rpcResult(id, result) {
  return { jsonrpc: '2.0', id, result }
}

function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id: id === undefined ? null : id, error: { code, message } }
}

/** No MCP o id de uma requisição é texto ou número (nunca nulo). */
function validId(id) {
  return typeof id === 'string' || (typeof id === 'number' && isFinite(id))
}

function negotiateVersion(requested) {
  return PROTOCOL_VERSIONS.indexOf(requested) >= 0 ? requested : PROTOCOL_VERSIONS[0]
}

/** Resultado de ferramenta: o JSON em texto (o formato que todo cliente MCP entende). */
function toolResult(payload, isError) {
  const result = { content: [{ type: 'text', text: JSON.stringify(payload === undefined ? null : payload) }] }
  if (isError) result.isError = true
  return result
}

function describeTool(tool) {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: Object.assign({ title: tool.title }, tool.annotations || {}),
  }
}

/**
 * @param {object} options
 * @param {Array} options.tools catálogo: { name, title, description, inputSchema, annotations, run }
 * @param {object} options.serverInfo { name, title, version }
 * @param {string} [options.instructions] orientação geral para o modelo
 */
function createMcpServer(options) {
  const byName = new Map(options.tools.map((tool) => [tool.name, tool]))
  const listing = options.tools.map(describeTool)

  /**
   * Erros da ferramenta (validação, permissão, regra de negócio) voltam como resultado com `isError`,
   * para o modelo ler e corrigir; só a ferramenta desconhecida é erro do protocolo.
   */
  async function callTool(id, params, context) {
    const name = isObject(params) ? params.name : undefined
    const tool = typeof name === 'string' ? byName.get(name) : undefined
    if (!tool) return rpcError(id, RPC.INVALID_PARAMS, `Unknown tool: ${typeof name === 'string' ? name : ''}`)
    const args = params.arguments === undefined ? {} : params.arguments
    try {
      const fields = validateArguments(args, tool.inputSchema)
      if (Object.keys(fields).length > 0) throw appError('VALIDATION_ERROR', undefined, { fields })
      return rpcResult(id, toolResult(await tool.run(args, context)))
    } catch (err) {
      if (!isAppError(err) && context && context.log) {
        context.log.error({ tool: tool.name, error: String((err && err.stack) || err) }, 'mcp tool unexpected error')
      }
      return rpcResult(id, toolResult({ error: toErrorPayload(err).error }, true))
    }
  }

  async function handleMessage(message, context) {
    if (!isObject(message) || message.jsonrpc !== '2.0') return rpcError(null, RPC.INVALID_REQUEST, 'Invalid Request')
    // resposta do cliente a uma pergunta do servidor: este servidor não pergunta nada
    if (message.method === undefined && ('result' in message || 'error' in message)) return null
    if (typeof message.method !== 'string') return rpcError(validId(message.id) ? message.id : null, RPC.INVALID_REQUEST, 'Invalid Request')
    // notificação (initialized, cancelled…): nada a responder
    if (!('id' in message)) return null
    if (!validId(message.id)) return rpcError(null, RPC.INVALID_REQUEST, 'Invalid Request')

    const id = message.id
    const params = message.params
    switch (message.method) {
      case 'initialize':
        return rpcResult(id, {
          protocolVersion: negotiateVersion(isObject(params) ? params.protocolVersion : undefined),
          capabilities: { tools: { listChanged: false } },
          serverInfo: options.serverInfo,
          instructions: options.instructions,
        })
      case 'ping':
        return rpcResult(id, {})
      case 'tools/list':
        return rpcResult(id, { tools: listing })
      case 'tools/call':
        return callTool(id, params, context)
      default:
        return rpcError(id, RPC.METHOD_NOT_FOUND, `Method not found: ${message.method}`)
    }
  }

  /**
   * Corpo já lido (uma mensagem ou um lote): devolve a resposta (objeto ou lista, na ordem das
   * requisições) ou null quando só havia notificações/respostas.
   */
  async function handlePayload(payload, context) {
    if (!Array.isArray(payload)) return handleMessage(payload, context)
    if (payload.length === 0) return rpcError(null, RPC.INVALID_REQUEST, 'Invalid Request')
    const responses = []
    for (const message of payload) {
      const response = await handleMessage(message, context)
      if (response) responses.push(response)
    }
    return responses.length > 0 ? responses : null
  }

  return { handlePayload }
}

module.exports = { createMcpServer, rpcError, PROTOCOL_VERSIONS, RPC }
