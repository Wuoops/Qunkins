import { Client, EventDispatcher, WSClient } from '@larksuiteoapi/node-sdk';

export interface FeishuConfig {
  appId: string;
  appSecret: string;
  encryptKey?: string;
}

export class FeishuWebhook {
  private client: Client;
  private wsClient?: WSClient;
  private messageHandler?: (chatId: string, message: string) => Promise<string>;

  constructor(config: FeishuConfig) {
    this.client = new Client({
      appId: config.appId,
      appSecret: config.appSecret
    });
  }

  setMessageHandler(handler: (chatId: string, message: string) => Promise<string>) {
    this.messageHandler = handler;
  }

  async startWebSocket() {
    if (!this.messageHandler) {
      throw new Error('Message handler not set. Call setMessageHandler first.');
    }

    this.wsClient = new WSClient({
      appId: process.env.FEISHU_APP_ID!,
      appSecret: process.env.FEISHU_APP_SECRET!,
      loggerLevel: 1
    });

    const dispatcher = new EventDispatcher({} as any);
    
    this.wsClient.start(
      dispatcher.register({
        'im.message.receive_v1': async (data) => {
          const chatId = data.message?.chat_id;
          const messageContent = data.message?.content;
          
          if (!chatId || !messageContent) return;

          try {
            const message = JSON.parse(messageContent).text;
            const response = await this.messageHandler!(chatId, message);
            await this.sendMessage(chatId, response);
          } catch (err) {
            console.error('Error processing message:', err);
          }
        }
      }) as any
    );

    console.log('Feishu WebSocket client started');
  }

  async handleWebhook(data: any): Promise<string> {
    const message = JSON.parse(data.message.content).text;
    const chatId = data.message.chat_id;

    if (this.messageHandler) {
      return await this.messageHandler(chatId, message);
    }
    return 'Handler not configured';
  }

  async sendMessage(chatId: string, content: string): Promise<void> {
    await this.client.im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: chatId,
        msg_type: 'text',
        content: JSON.stringify({ text: content })
      }
    });
  }

  async sendRichMessage(chatId: string, title: string, content: string): Promise<void> {
    await this.client.im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: chatId,
        msg_type: 'interactive',
        content: JSON.stringify({
          config: { wide_screen_mode: true },
          elements: [
            {
              tag: 'markdown',
              content: `**${title}**\n${content}`
            }
          ]
        })
      }
    });
  }

  async sendCard(chatId: string, cardContent: object): Promise<void> {
    await this.client.im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: chatId,
        msg_type: 'interactive',
        content: JSON.stringify(cardContent)
      }
    });
  }

  stop() {}
}
