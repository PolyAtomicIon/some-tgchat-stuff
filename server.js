// import { ChatGPTAPI, ChatGPTUnofficialProxyAPI } from "chatgpt";
import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";
import { v1, helpers } from "@google-cloud/aiplatform";
import { v1p1beta1 } from "@google-cloud/speech";
import fs from "fs";
import fetch from "node-fetch";

// speaking json from samples
let rawSpeakingSampledata = fs.readFileSync("./samples/speaking.json");
let speakingSamples = JSON.parse(rawSpeakingSampledata);

const { PredictionServiceClient } = v1;
const { SpeechClient } = v1p1beta1;

dotenv.config();

const baseUrl = "https://unlock.devhouse.kz";
const donationLink =
  "https://kaspi.kz/transfers/categories/kaspi-client?destCardNumber=4400430112506974&requisiteInputMethod=scan-card-camera";
const API_ENDPOINT = process.env.API_ENDPOINT;
const PROJECT_ID = process.env.PROJECT_ID;
const MODEL_ID = process.env.MODEL_ID;
let question,
  taskName,
  answer,
  ieltsSpeakingQuestionIndex = -1,
  ieltsSpeakingPartIndex = -1;

const bot = new TelegramBot(process.env.BOT_TOKEN, {
  polling: true,
  port: 3000,
});

const generateSamplesList = (actionType) => {
  let keyboard = [
    ...speakingSamples.map(({ topic }, index) => {
      if (actionType === "speaking-choose-index") {
        return [
          {
            text: `Sample ${index + 1}: ${topic}`,
            callback_data: `${actionType}-${index}`,
          },
        ];
      } else {
        const sample = JSON.stringify(speakingSamples[index]);
        let url = `${baseUrl}/sample-editor/?sampleIndex=${index}&sample=${sample}`;
        url = encodeURI(url);
        return [
          {
            text: `Edit Sample ${index + 1}: ${topic}`,
            web_app: {
              url,
            },
          },
        ];
      }
    }),
  ];

  if (actionType === "edit-sample-index") {
    let url = `${baseUrl}/sample-editor/?sampleIndex=-99&sample=${JSON.stringify(
      { topic: "", part1: "", part2: "", part3: "", part4: "" }
    )}`;
    url = encodeURI(url);
    keyboard = [
      [
        {
          text: `Add new sample`,
          web_app: { url },
        },
      ],
      ...keyboard,
    ];

    return {
      reply_markup: JSON.stringify({
        keyboard,
      }),
    };
  } else {
    return {
      reply_markup: JSON.stringify({
        inline_keyboard: keyboard,
      }),
    };
  }
};
const generatePromptEditorList = () => {
  const prompts = ["writing-task-1", "writing-task-2", "speaking"];

  const promptsText = prompts.map((prompt) => {
    let text = fs.readFileSync(prompt + "Prompt.txt", "utf8");
    text = text.replace(/(?:\r\n|\r|\n)/g, " ");
    while (text.includes("&")) {
      text = text.replace("&", "and");
    }
    return text;
  });

  let keyboard = prompts.map((prompt, index) => {
    let url = `${baseUrl}/prompt-editor/?prompt=${promptsText[index]}&taskName=${prompt}`;
    url = encodeURI(url);
    return [
      {
        text: `Edit ${prompt} prompt`,
        web_app: {
          url,
        },
      },
    ];
  });

  return {
    reply_markup: JSON.stringify({
      keyboard,
    }),
  };
};
const addSample = (sample) => {
  speakingSamples.push(sample);
  fs.writeFileSync("./samples/speaking.json", JSON.stringify(speakingSamples));
};
const deleteSample = (index) => {
  speakingSamples.splice(index, 1);
  fs.writeFileSync("./samples/speaking.json", JSON.stringify(speakingSamples));
};

const optionsGenerator = (msg, addResultToMessage, text) => {
  let keyboard = [];

  if (addResultToMessage) {
    text = text.replace(/(?:\r\n|\r|\n)/g, "<br/>");
    while (text.includes("&")) {
      text = text.replace("&", "and");
    }
    let url = `${baseUrl}/result/?chatId=${msg.chat.id}&question=${question}&answer=${answer}&result=${text}&taskName=${taskName}&donationLink=${donationLink}`;
    url = encodeURI(url);
    keyboard.push([
      {
        text: "See detailed Result",
        web_app: {
          url,
        },
      },
    ]);
  }

  keyboard.push(
    [
      {
        text: "Writing task 1",
        web_app: {
          url: `${baseUrl}/?chatId=${msg.chat.id}&taskName=writing-task-1`,
        },
      },
    ],
    [
      {
        text: "Writing task 2",
        web_app: {
          url: `${baseUrl}/?chatId=${msg.chat.id}&taskName=writing-task-2`,
        },
      },
    ],
    [
      {
        text: "Speaking",
      },
    ]
  );

  return {
    reply_markup: JSON.stringify({
      keyboard,
    }),
    parse_mode: "HTML",
  };
};
const generatePrompt = (type, question, answer) => {
  // read from file
  let promptTemplate = fs.readFileSync(type + "Prompt.txt", "utf8");
  promptTemplate = promptTemplate.replace("{{Task}}", question);
  promptTemplate = promptTemplate.replace("{{Answer}}", answer);
  console.log(promptTemplate);
  return promptTemplate;
};
const changePrompt = (type, prompt) => {
  // write to file
  fs.writeFileSync(type + "Prompt.txt", prompt);
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

const handleTgMessage = async (msg) => {
  const text = msg?.text || "no text";
  const { id: chatId } = msg.chat;
  console.log(msg);
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
  } else if (text === "Speaking") {
    await bot.sendMessage(
      chatId,
      `Choose speaking sample number:`,
      generateSamplesList("speaking-choose-index")
    );
  } else if (text === "/admin") {
    await bot.sendMessage(
      chatId,
      `Choose speaking sample number to edit:`,
      generateSamplesList("edit-sample-index")
    );
  } else if (text === "/prompt") {
    await bot.sendMessage(
      chatId,
      `Change promt for:`,
      generatePromptEditorList()
    );
  }
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
    const isPrompt = data.isPrompt;
    const isAddSample = data.isAddSample;
    const isDeleteSample = data.isDeleteSample;
    const isEditSample = data.isEditSample;

    if (isPrompt) {
      const prompt = data.prompt;
      changePrompt(type, prompt);
      return;
    }

    if (isAddSample) {
      addSample(data.sample);
    }
    if (isEditSample) {
      speakingSamples[data.index] = data.sample;
      fs.writeFileSync("./speaking.json", JSON.stringify(speakingSamples));
    }
    if (isDeleteSample) {
      deleteSample(data.index);
    }

    if (isAddSample || isDeleteSample || isEditSample) {
      await bot.sendMessage(
        chatId,
        `Choose speaking sample number to edit:`,
        generateSamplesList("edit-sample-index")
      );
      return;
    }

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
    taskName = type;
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
    optionsGenerator(msg, true, response.text)
  );
};
const handleVoiceMessage = async (msg) => {
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

    let url = `${baseUrl}/?chatId=${msg.chat.id}&question=${question}&answer=${recognizedText}&taskName=speaking`;
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
                url: donationLink,
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
};
(async () => {
  const { first_name: botName } = await bot.getMe();

  bot.on("callback_query", async (msg) => {
    const { id: chatId } = msg.message.chat;
    const data = msg.data;
    console.log(data);
    if (data.includes("speaking-choose-index")) {
      ieltsSpeakingQuestionIndex = data.split("-")[3];

      const buttonForManualTaskInput = [
        {
          text: `Enter task manually`,
          web_app: {
            url: `${baseUrl}/?chatId=${chatId}&taskName=speaking-prep`,
          },
        },
      ];

      await bot.sendMessage(
        chatId,
        `You've chosen sample number ${ieltsSpeakingQuestionIndex}.  \n Choose speaking section part number:`,
        {
          reply_to_message_id: msg.message_id,
          reply_markup: JSON.stringify({
            inline_keyboard: [
              ...[1, 2, 3].map((part, index) => {
                return [
                  {
                    text: `Part ${index + 1}`,
                    callback_data: `speaking-choose-part-${index}`,
                  },
                ];
              }),
              buttonForManualTaskInput,
            ],
          }),
        }
      );
    } else if (data.includes("part")) {
      if (ieltsSpeakingQuestionIndex === -1) {
        await bot.sendMessage(
          chatId,
          `You've not chosen sample number.  \n Choose speaking section part number:`,
          generateSamplesList("speaking-choose-index")
        );
        return;
      }

      const partIndex = +data.split("-")[3];
      ieltsSpeakingPartIndex = partIndex + 1;

      question =
        speakingSamples[ieltsSpeakingQuestionIndex][
          "part" + ieltsSpeakingPartIndex
        ];

      await bot.sendMessage(
        chatId,
        `Send Voice message as your answer for speaking task question. \n 
      Part: ${ieltsSpeakingPartIndex} \n
      Question: ${question}`,
        {
          reply_to_message_id: msg.message_id,
        }
      );
    }
  });
  bot.on("web_app_data", handleWebMessage);
  bot.on("text", handleTgMessage);
  bot.on("voice", handleVoiceMessage);

  console.log(new Date(), `${botName} is ready ✨`);
})();
