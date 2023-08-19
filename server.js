import { ChatGPTAPI, ChatGPTUnofficialProxyAPI } from "chatgpt";
import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";

dotenv.config();

(async () => {
  // console.log(process.env.ACCESS_TOKEN);
  const api = new ChatGPTAPI({
    apiKey: process.env.ACCESS_TOKEN,
    completionParams: {
      model: "gpt-3.5-turbo",
      temperature: 0.5,
      top_p: 0.8,
    },
  });

  // console.log(res.text);
  // await api.ensureAuth();
  const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
  const { first_name: botName } = await bot.getMe();
  // console.log(botName);
  bot.on("message", async (msg) => {
    const text = msg?.text || "no text";
    const { id: chatId } = msg.chat;
    console.log(new Date(), `${msg.from.username}: ${text}`);
    if (text === "new") {
      await bot.sendMessage(chatId, "Starting new conversation", {
        reply_to_message_id: msg.message_id,
      });
    } else {
      await bot.sendChatAction(chatId, "typing");
      // const typingInterval = setInterval(
      //   async () => await bot.sendChatAction(chatId, "typing"),
      //   5000
      // );
      let response;
      try {
        let count = 0;
        const maxTries = 1;
        while (true) {
          try {
            response = await api.sendMessage(text);
            break;
          } catch (error) {
            if (++count === maxTries) throw error;
          }
        }
      } catch (error) {
        response = error.toString();
      }
      console.log(response);
      // clearInterval(typingInterval);
      await bot.sendMessage(chatId, response?.text || "error", {
        reply_to_message_id: msg.message_id,
      });
    }
  });
  console.log(new Date(), `${botName} is ready ✨`);
})();
