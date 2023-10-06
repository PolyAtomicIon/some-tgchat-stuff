import { ChatGPTAPI, ChatGPTUnofficialProxyAPI } from "chatgpt";
import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";
import { v1, helpers } from "@google-cloud/aiplatform";

const { PredictionServiceClient } = v1;

dotenv.config();

const API_ENDPOINT = process.env.API_ENDPOINT;
const PROJECT_ID = process.env.PROJECT_ID;
const MODEL_ID = process.env.MODEL_ID;

const bot = new TelegramBot(process.env.BOT_TOKEN, {
  polling: true,
  port: 3000,
});

const requestVertexAI = async (text) => {
  // Instantiates a client
  const aiplatformClient = new PredictionServiceClient({
    apiEndpoint: API_ENDPOINT,
  });

  async function callPredict() {
    const instanceValue = helpers.toValue({
      content: text,
    });
    const instances = [instanceValue];

    const parameter = {
      temperature: 0.2,
      maxOutputTokens: 256,
      topP: 0.95,
      topK: 40,
    };
    const parameters = helpers.toValue(parameter);

    const request = {
      endpoint: `projects/${PROJECT_ID}/locations/us-central1/publishers/google/models/${MODEL_ID}`,
      instances,
      parameters,
    };

    // Run request

    // Get model evaluation request
    const [response] = await aiplatformClient.predict(request);
    // console.log("Get text summarization response");
    const predictions = response.predictions;
    // console.log("\tPredictions :");
    return predictions[0].structValue.fields.content.stringValue;
  }

  return await callPredict();
};

const handleTgMessage = async (msg) => {
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
          // open ai api
          // response = await api.sendMessage(text);

          // vertex ai
          response = {
            text: await requestVertexAI(text),
          };

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
};

(async () => {
  const api = new ChatGPTAPI({
    apiKey: process.env.ACCESS_TOKEN,
    completionParams: {
      model: "gpt-3.5-turbo",
      temperature: 0.5,
      top_p: 0.8,
    },
  });

  const { first_name: botName } = await bot.getMe();
  // console.log(botName);

  bot.on("message", handleTgMessage);
  bot.on("web_app_data", handleTgMessage);

  console.log(new Date(), `${botName} is ready ✨`);
})();
