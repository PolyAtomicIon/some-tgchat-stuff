import { ChatGPTAPI, ChatGPTUnofficialProxyAPI } from "chatgpt";
import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";
import { v1, helpers } from "@google-cloud/aiplatform";
import { v1p1beta1 } from "@google-cloud/speech";
import fs from "fs";
import fetch from "node-fetch";

const { PredictionServiceClient } = v1;
const { SpeechClient } = v1p1beta1;

dotenv.config();

const API_ENDPOINT = process.env.API_ENDPOINT;
const PROJECT_ID = process.env.PROJECT_ID;
const MODEL_ID = process.env.MODEL_ID;

const bot = new TelegramBot(process.env.BOT_TOKEN, {
  polling: true,
  port: 3000,
});

async function syncRecognizeWithEnhancedModel(audioFilePath) {
  // audio file is oga format
  const encoding = "OGG_OPUS";
  const sampleRateHertz = 16000;
  const languageCode = "en-US";

  const config = {
    encoding: encoding,
    languageCode: languageCode,
    useEnhanced: true,
    model: "phone_call",
    sampleRateHertz: 48000,
  };

  const client = new SpeechClient({
    apiEndpoint: process.env.SPEECH_ENDPOINT,
  });

  const gcsUri = audioFilePath;
  console.log(audioFilePath);

  // download file from telegram - audioFilePath
  const file = fs.createWriteStream("speech_sample.ogg");

  // Make a fetch request to the URL
  const audioResponse = await fetch(audioFilePath);

  if (!audioResponse.ok) {
    throw new Error(`HTTP error! Status: ${audioResponse.status}`);
  }

  // Create a writable stream to write data to the file
  const fileStream = fs.createWriteStream("speech_sample.ogg");

  // Use the pipe method to pipe the audioResponse body to the file stream
  audioResponse.body.pipe(fileStream);
  let text = "Could not recognize the speech, try again later";
  await new Promise((resolve, reject) => {
    // Listen for the 'finish' event to know when the file write is complete
    fileStream.on("finish", async () => {
      console.log(`File saved as ${audioFilePath}`);
      const audio = {
        content: fs.readFileSync("speech_sample.ogg").toString("base64"),
        // uri: audioFilePath,
      };

      const request = {
        config: config,
        audio: audio,
      };

      // Detects speech in the audio file
      const [response] = await client.recognize(request);
      // console.log(response);
      // response.results.forEach((result) => {
      //   const alternative = result.alternatives[0];
      //   console.log(alternative?.transcript);
      // });
      // [END speech_transcribe_enhanced_model]

      text = response.results[0].alternatives[0].transcript;
      resolve();
    });
  });

  return text;
}

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

  bot.on("text", handleTgMessage);
  bot.on("web_app_data", handleTgMessage);
  bot.on("voice", async (msg) => {
    console.log("voice handling");
    const voice = await bot.getFile(msg.voice.file_id);
    // console.log(voice);
    const { id: chatId } = msg.chat;

    const audioFilePath = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${voice.file_path}`;
    const text = await syncRecognizeWithEnhancedModel(audioFilePath);

    await bot.sendMessage(
      chatId,
      text || "Could not recognize, try later please",
      {
        reply_to_message_id: msg.message_id,
      }
    );
  });

  console.log(new Date(), `${botName} is ready ✨`);
})();
