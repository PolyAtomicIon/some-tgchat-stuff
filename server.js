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

const optionsGenerator = (msg) => ({
  reply_markup: JSON.stringify({
    keyboard: [
      [
        {
          text: "Writing task 1",
          web_app: {
            url: `https://unlock.devhouse.kz/?chatId=${msg.chat.id}&taskName=writing-task-1`,
          },
        },
      ],
      [
        {
          text: "Writing task 2",
          web_app: {
            url: `https://unlock.devhouse.kz/?chatId=${msg.chat.id}&taskName=writing-task-2`,
          },
        },
      ],
      [
        {
          text: "Speaking",
          web_app: {
            url: `https://unlock.devhouse.kz/?chatId=${msg.chat.id}&taskName=speaking-prep`,
          },
        },
      ],
    ],
  }),
  parse_mode: "HTML",
});

const generatePrompt = (type, question, answer) => {
  // read from file
  let promptTemplate = fs.readFileSync(type + "Prompt.txt", "utf8");
  promptTemplate = promptTemplate.replace("{{Task}}", question);
  promptTemplate = promptTemplate.replace("{{Answer}}", answer);
  console.log(promptTemplate);
  return promptTemplate;
};

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
    return;
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

      text = response.results[0]?.alternatives[0]?.transcript ?? "error";
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

let question, answer;

const handleTgMessage = async (msg) => {
  const text = msg?.text || "no text";
  const { id: chatId } = msg.chat;
  console.log(new Date(), `${msg.from.username}: ${text}`);
  if (text.includes("/start")) {
    try {
      await bot.sendMessage(
        msg.chat.id,
        "Welcome to english Unlock IELTS evaluation bot!",
        optionsGenerator(msg)
      );
    } catch (error) {
      console.log(error);
    }
  }
  // if (text.includes("/speaking-question")) {
  //   question = text;
  //   await bot.sendMessage(
  //     chatId,
  //     "Send Voice message as your answer for speaking task question, include /speaking-voice command in your message.",
  //     {
  //       reply_to_message_id: msg.message_id,
  //     }
  //   );
  // } else if (text.includes("/speaking-voice")) {
  //   await bot.sendChatAction(chatId, "typing");
  //   const prompt = generatePrompt("speaking", question, text);

  //   let response;
  //   try {
  //     let count = 0;
  //     const maxTries = 1;
  //     while (true) {
  //       try {
  //         // open ai api
  //         // response = await api.sendMessage(text);

  //         // vertex ai
  //         response = {
  //           text: await requestVertexAI(prompt),
  //         };

  //         break;
  //       } catch (error) {
  //         if (++count === maxTries) throw error;
  //       }
  //     }
  //   } catch (error) {
  //     response = error.toString();
  //   }

  //   await bot.sendMessage(
  //     chatId,
  //     `Here is the your evaluatation for given question and your speech: \n ${response?.text}`,
  //     {
  //       reply_to_message_id: msg.message_id,
  //     }
  //   );
  // } else if (text.includes("/speaking")) {
  //   await bot.sendMessage(
  //     chatId,
  //     "Send Speaking Question, only by one. \n , include /speaking-question command in your message.",
  //     {
  //       reply_to_message_id: msg.message_id,
  //     }
  //   );
  // } else if (text.includes("/writing-question")) {
  //   question = text;
  //   await bot.sendMessage(
  //     chatId,
  //     `Send Your essay for the question \n Include /writing-text command in your message.`,
  //     {
  //       reply_to_message_id: msg.message_id,
  //     }
  //   );
  // } else if (text.includes("/writing-text")) {
  //   await bot.sendChatAction(chatId, "typing");
  //   const prompt = generatePrompt("writing", question, text);

  //   let response;
  //   try {
  //     let count = 0;
  //     const maxTries = 1;
  //     while (true) {
  //       try {
  //         // open ai api
  //         // response = await api.sendMessage(text);

  //         // vertex ai
  //         response = {
  //           text: await requestVertexAI(prompt),
  //         };

  //         break;
  //       } catch (error) {
  //         if (++count === maxTries) throw error;
  //       }
  //     }
  //   } catch (error) {
  //     response = error.toString();
  //   }

  //   await bot.sendMessage(
  //     chatId,
  //     `Here is the your evaluatation for given question and your essay: \n ${response?.text}`,
  //     {
  //       reply_to_message_id: msg.message_id,
  //     }
  //   );
  // } else if (text.includes("/writing")) {
  // } else {
  //   await bot.sendChatAction(chatId, "typing");
  //   // const typingInterval = setInterval(
  //   //   async () => await bot.sendChatAction(chatId, "typing"),
  //   //   5000
  //   // );
  //   let response;
  //   try {
  //     let count = 0;
  //     const maxTries = 1;
  //     while (true) {
  //       try {
  //         // open ai api
  //         // response = await api.sendMessage(text);

  //         // vertex ai
  //         response = {
  //           text: await requestVertexAI(text),
  //         };

  //         break;
  //       } catch (error) {
  //         if (++count === maxTries) throw error;
  //       }
  //     }
  //   } catch (error) {
  //     response = error.toString();
  //   }
  //   console.log(response);
  //   // clearInterval(typingInterval);
  //   await bot.sendMessage(chatId, response?.text || "error", {
  //     reply_to_message_id: msg.message_id,
  //   });
  // }
};

const handleWebMessage = async (msg) => {
  console.log("handling web message");
  const text = msg?.web_app_data.data || "no text";
  const { id: chatId } = msg.chat;

  const data = JSON.parse(text);
  let response;
  console.log(data);

  try {
    question = data.question;
    answer = data.answer;
    const type = data.type;

    if (type === "speaking-prep") {
      await bot.sendMessage(
        chatId,
        "Send Voice message as your answer for speaking task question.",
        {
          reply_to_message_id: msg.message_id,
        }
      );
      return;
    }

    await bot.sendChatAction(chatId, "typing");
    const prompt = generatePrompt(type, question, answer);

    let count = 0;
    const maxTries = 1;
    while (true) {
      try {
        // open ai api
        // response = await api.sendMessage(text);

        // vertex ai
        response = {
          text: await requestVertexAI(prompt),
        };

        break;
      } catch (error) {
        if (++count === maxTries) throw error;
      }
    }
  } catch (error) {
    response = error.toString();
    console.log(response);
  }

  await bot.sendMessage(
    chatId,
    response.text || "Error ",
    optionsGenerator(msg)
  );
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

  bot.on("web_app_data", handleWebMessage);
  bot.on("text", handleTgMessage);
  bot.on("voice", async (msg) => {
    console.log("voice handling");
    const voice = await bot.getFile(msg.voice.file_id);
    // console.log(voice);
    const { id: chatId } = msg.chat;
    try {
      await bot.sendMessage(
        chatId,
        "We are processing your audio, please wait...",
        {
          reply_to_message_id: msg.message_id,
        }
      );
      await bot.sendChatAction(chatId, "typing");

      const audioFilePath = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${voice.file_path}`;

      let count = 0;
      const maxTries = 1;
      let recognizedText;
      while (true) {
        try {
          recognizedText = await syncRecognizeWithEnhancedModel(audioFilePath);
          break;
        } catch (error) {
          if (++count === maxTries) throw error;
        }
      }
      if (!recognizedText) {
        await bot.sendMessage(
          chatId,
          "Could not recognize the speech, try again later",
          {
            reply_to_message_id: msg.message_id,
          }
        );
        return;
      }
      const text =
        `This is recognized text, please edit and resend it: ` + recognizedText;
      console.log(
        `https://unlock.devhouse.kz/?chatId=${msg.chat.id}&question=${question}&answer=${recognizedText}&taskName=speaking`
      );

      let url = `https://unlock.devhouse.kz/?chatId=${msg.chat.id}&question=${question}&answer=${recognizedText}&taskName=speaking`;
      url = encodeURI(url);

      const options = {
        reply_markup: JSON.stringify({
          keyboard: [
            [
              {
                text: "Edit your speech",
                web_app: {
                  url,
                },
              },
            ],
            [
              {
                text: "Donate",
                web_app: {
                  url: "https://kaspi.kz/transfers/categories/kaspi-client?destCardNumber=4400430112506974&requisiteInputMethod=scan-card-camera",
                },
              },
            ],
          ],
        }),
        parse_mode: "HTML",
      };

      await bot.sendMessage(
        chatId,
        text || "Could not recognize, try later please",
        options
      );
    } catch (error) {
      console.log(error);
    }
  });

  console.log(new Date(), `${botName} is ready ✨`);
})();
