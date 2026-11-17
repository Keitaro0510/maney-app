// Claude から予定・タスクを入れる MCP サーバー（Issue #190）。
// いまは「検証用」: データには触れず、ログインした人が誰かだけを返す（hello・whoami）。
// 認証は、Supabase Auth を OAuth 2.1 の認可サーバーにする。この関数は、トークンを確かめて、その人として動く。
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'

import { createMcpHandler, McpServer } from 'npm:@modelcontextprotocol/server@^2.0.0'
import { pipeline } from 'npm:@supabase/middleware@1'
import { withOAuthProtectedResource, withSupabase } from 'npm:@supabase/server@1'
import { z } from 'npm:zod@^4.3.6'

Deno.serve(
  pipeline(
    // 1. MCP クライアントに「どこで認証するか」を教える 2. その人のトークンを確かめ、その人として動くクライアントを渡す
    [withOAuthProtectedResource(), withSupabase({ auth: 'user' })],
    async (req, { supabase }) => {
      // Edge Functions は状態を持たないので、リクエストごとにサーバーを作る
      const handler = createMcpHandler(() => {
        const server = new McpServer({ name: 'maney', version: '0.0.1' })

        server.registerTool(
          'hello',
          {
            description: '動作確認用。あいさつを返す。データには触れない',
            inputSchema: z.object({ name: z.string().min(1).max(50).default('キリン') }),
            annotations: { readOnlyHint: true },
          },
          ({ name }) => ({ content: [{ type: 'text', text: `こんにちは、${name}！` }] }),
        )

        server.registerTool(
          'whoami',
          {
            description: '動作確認用。ログインしている人のメールアドレスを返す。データには触れない',
            inputSchema: z.object({}),
            annotations: { readOnlyHint: true },
          },
          async () => {
            const { data, error } = await supabase.auth.getUser()
            if (error) throw new Error(error.message)
            return { content: [{ type: 'text', text: data.user?.email ?? '(メールなし)' }] }
          },
        )

        return server
      })

      return handler.fetch(req)
    },
  ),
)
