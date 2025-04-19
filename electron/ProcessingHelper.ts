import fs from "node:fs"
import { ScreenshotHelper } from "./ScreenshotHelper"
import { IProcessingHelperDeps } from "./main"
import { app, BrowserWindow } from "electron"
import OpenAI from "openai"

let openai: OpenAI | null = null

const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini-2025-04-14"
const OPENAI_RESPONSE_LANGUAGE = process.env.OPENAI_RESPONSE_LANGUAGE || "Russian"

export class ProcessingHelper {
  private deps: IProcessingHelperDeps
  private screenshotHelper: ScreenshotHelper

  // AbortControllers for API requests
  private currentProcessingAbortController: AbortController | null = null
  private currentExtraProcessingAbortController: AbortController | null = null

  constructor(deps: IProcessingHelperDeps) {
    this.deps = deps
    this.screenshotHelper = deps.getScreenshotHelper()

    if (!openai) {
      if (!process.env.OPENAI_API_KEY) {
        throw new Error("OPENAI_API_KEY environment variable is not set")
      }
      openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
        maxRetries: 1,
        timeout: 60000
      })
    }
  }

  // Helper function to wrap OpenAI calls with logging
  private async _callOpenAI(
    context: string,
    params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
    options?: OpenAI.RequestOptions
  ): Promise<OpenAI.Chat.ChatCompletion> {
    if (!openai) {
      throw new Error("OpenAI client is not initialized");
    }
    console.log(`[OpenAI Request - ${context}] Sending request:`, JSON.stringify(params.messages, null, 2)); // Log request messages
    try {
      const response = await openai.chat.completions.create(params, options);
      console.log(`[OpenAI Response - ${context}] Received response:`, JSON.stringify(response, null, 2)); // Log full response
      return response;
    } catch (error: any) {
      console.error(`[OpenAI Error - ${context}] Request failed:`, JSON.stringify(error, null, 2)); // Log full error
      throw error; // Re-throw the error to be handled by the caller
    }
  }


  private async waitForInitialization(
    mainWindow: BrowserWindow
  ): Promise<void> {
    let attempts = 0
    const maxAttempts = 50 // 5 seconds total

    while (attempts < maxAttempts) {
      const isInitialized = await mainWindow.webContents.executeJavaScript(
        "window.__IS_INITIALIZED__"
      )
      if (isInitialized) return
      await new Promise((resolve) => setTimeout(resolve, 100))
      attempts++
    }
    throw new Error("App failed to initialize after 5 seconds")
  }

  private async getCredits(): Promise<number> {
    // Always return a high number of credits
    return 999
  }

  private async getLanguage(): Promise<string> {
    const mainWindow = this.deps.getMainWindow()
    if (!mainWindow) return "python"

    try {
      await this.waitForInitialization(mainWindow)
      const language = await mainWindow.webContents.executeJavaScript(
        "window.__LANGUAGE__"
      )

      if (
        typeof language !== "string" ||
        language === undefined ||
        language === null
      ) {
        console.warn("Language not properly initialized")
        return "python"
      }

      return language
    } catch (error) {
      console.error("Error getting language:", error)
      return "python"
    }
  }

  public async processScreenshots(): Promise<void> {
    const mainWindow = this.deps.getMainWindow()
    if (!mainWindow) return

    // Credits check is bypassed - we always have enough credits
    
    const view = this.deps.getView()
    console.log("Processing screenshots in view:", view)

    if (view === "queue") {
      mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.INITIAL_START)
      const screenshotQueue = this.screenshotHelper.getScreenshotQueue()
      console.log("Processing main queue screenshots:", screenshotQueue)
      if (screenshotQueue.length === 0) {
        mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS)
        return
      }

      try {
        // Initialize AbortController
        this.currentProcessingAbortController = new AbortController()
        const { signal } = this.currentProcessingAbortController

        const screenshots = await Promise.all(
          screenshotQueue.map(async (path) => ({
            path,
            preview: await this.screenshotHelper.getImagePreview(path),
            data: fs.readFileSync(path).toString("base64")
          }))
        )

        const result = await this.processScreenshotsHelper(screenshots, signal)

        if (!result.success) {
          console.log("Processing failed:", result.error)
          if (result.error?.includes("API Key out of credits")) {
            mainWindow.webContents.send(
              this.deps.PROCESSING_EVENTS.OUT_OF_CREDITS
            )
          } else if (result.error?.includes("OpenAI API key not found")) {
            mainWindow.webContents.send(
              this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR,
              "OpenAI API key not found in environment variables. Please set the OPEN_AI_API_KEY environment variable."
            )
          } else {
            mainWindow.webContents.send(
              this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR,
              result.error
            )
          }
          // Reset view back to queue on error
          console.log("Resetting view to queue due to error")
          this.deps.setView("queue")
          return
        }

        // Only set view to solutions if processing succeeded
        console.log("Setting view to solutions after successful processing")
        mainWindow.webContents.send(
          this.deps.PROCESSING_EVENTS.SOLUTION_SUCCESS,
          result.data
        )
        this.deps.setView("solutions")
      } catch (error: any) {
        mainWindow.webContents.send(
          this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR,
          error
        )
        console.error("Processing error:", error)
        if (error.name === "CanceledError") {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR,
            "Processing was canceled by the user."
          )
        } else {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR,
            error.message || "Server error. Please try again."
          )
        }
        // Reset view back to queue on error
        console.log("Resetting view to queue due to error")
        this.deps.setView("queue")
      } finally {
        this.currentProcessingAbortController = null
      }
    } else {
      // view == 'solutions'
      const extraScreenshotQueue =
        this.screenshotHelper.getExtraScreenshotQueue()
      console.log("Processing extra queue screenshots:", extraScreenshotQueue)
      if (extraScreenshotQueue.length === 0) {
        mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS)
        return
      }
      mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.DEBUG_START)

      // Initialize AbortController
      this.currentExtraProcessingAbortController = new AbortController()
      const { signal } = this.currentExtraProcessingAbortController

      try {
        const screenshots = await Promise.all(
          [
            ...this.screenshotHelper.getScreenshotQueue(),
            ...extraScreenshotQueue
          ].map(async (path) => ({
            path,
            preview: await this.screenshotHelper.getImagePreview(path),
            data: fs.readFileSync(path).toString("base64")
          }))
        )
        console.log(
          "Combined screenshots for processing:",
          screenshots.map((s) => s.path)
        )

        const result = await this.processExtraScreenshotsHelper(
          screenshots,
          signal
        )

        if (result.success) {
          this.deps.setHasDebugged(true)
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.DEBUG_SUCCESS,
            result.data
          )
        } else {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.DEBUG_ERROR,
            result.error
          )
        }
      } catch (error: any) {
        if (error.name === "CanceledError") {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.DEBUG_ERROR,
            "Extra processing was canceled by the user."
          )
        } else {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.DEBUG_ERROR,
            error.message
          )
        }
      } finally {
        this.currentExtraProcessingAbortController = null
      }
    }
  }

  private async processScreenshotsHelper(
    screenshots: Array<{ path: string; data: string }>,
    signal: AbortSignal
  ) {
    try {
      const imageDataList = screenshots.map((screenshot) => screenshot.data)
      const mainWindow = this.deps.getMainWindow()
      const language = await this.getLanguage()

      // Use the helper function for the API call
      const extractResponse = await this._callOpenAI("Extract", {
        model: OPENAI_MODEL,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                // Updated prompt to explicitly ask for the code snippet as well and mention response language
                text: `Extract the coding problem statement AND the relevant code snippet from these images. The problem might be stated as a question (e.g., "What will this code output?"). Ensure you include the actual code itself, not just the question. Programming Language: ${language}. Respond in ${OPENAI_RESPONSE_LANGUAGE}. Return the combined problem statement and code.`
              },
              ...imageDataList.map(image => ({
                type: "image_url" as "image_url",
                image_url: { url: `data:image/jpeg;base64,${image}` }
              }))
            ]
          }
        ],
        max_tokens: 2000
      }, { signal });

      const problemInfo = extractResponse.choices[0]?.message?.content || ""

      // Store problem info in AppState
      this.deps.setProblemInfo({ problem_statement: problemInfo })

      // Send first success event
      if (mainWindow) {
        mainWindow.webContents.send(
          this.deps.PROCESSING_EVENTS.PROBLEM_EXTRACTED,
          { problem_statement: problemInfo }
        )

        // Generate solutions after successful extraction
        const solutionsResult = await this.generateSolutionsHelper(signal)
        if (solutionsResult.success) {
          // Clear any existing extra screenshots before transitioning to solutions view
          this.screenshotHelper.clearExtraScreenshotQueue()
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.SOLUTION_SUCCESS,
            solutionsResult.data
          )
          return { success: true, data: solutionsResult.data }
        } else {
          throw new Error(
            solutionsResult.error || "Failed to generate solutions"
          )
        }
      }
    } catch (error: any) {
      if (error.name === "CanceledError") {
        return {
          success: false,
          error: "Processing was canceled by the user."
        }
      }

      console.error("Processing error details:", {
        message: error.message,
        code: error.code,
        response: error.response,
      })

      return { success: false, error: error.message }
    }
  }

  private async generateSolutionsHelper(signal: AbortSignal) {
    try {
      const problemInfo = this.deps.getProblemInfo()
      const language = await this.getLanguage()

      if (!problemInfo) {
        throw new Error("No problem info available")
      }

      // Use the helper function for the API call
      const response = await this._callOpenAI("Generate", {
        model: OPENAI_MODEL,
        messages: [
          {
            role: "system",
            // Updated system prompt for conciseness, prioritization, full language adherence, and short_answer field
            content: `You are an expert coding assistant. Analyze the provided problem and code snippet.
Respond ENTIRELY in ${OPENAI_RESPONSE_LANGUAGE}. Be concise and focus on the essential information.

Instructions:
1.  If possible, provide a very brief, direct answer to the problem first (e.g., the final output value or a direct yes/no).
2.  Then, provide the detailed explanation, code, and complexity analysis.
3.  Generate a response in JSON format containing the following fields:
    - "short_answer": (Nullable string) A very brief, direct answer to the problem, if applicable (e.g., the program's output). Use null if not applicable. MUST be in ${OPENAI_RESPONSE_LANGUAGE}.
    - "code": (String) The corrected or proposed code solution in ${language}. Comments within the code MUST be in ${OPENAI_RESPONSE_LANGUAGE}.
    - "thoughts": (Array of strings) Explanation of your thought process, step-by-step. MUST be in ${OPENAI_RESPONSE_LANGUAGE}.
    - "time_complexity": (String) Time complexity analysis (e.g., "O(n)"). MUST be in ${OPENAI_RESPONSE_LANGUAGE}.
    - "space_complexity": (String) Space complexity analysis (e.g., "O(1)"). MUST be in ${OPENAI_RESPONSE_LANGUAGE}.

If the problem statement is incomplete or unclear, set "short_answer" to null, explain the issue clearly in the "thoughts" field (in ${OPENAI_RESPONSE_LANGUAGE}), and set "code" to an empty string or a relevant placeholder comment (in ${OPENAI_RESPONSE_LANGUAGE}).`
          },
          {
            role: "user",
            // Ensure the problem statement from extraction is passed correctly
            content: `Problem and Code:\n\`\`\`\n${problemInfo.problem_statement}\n\`\`\`\n\nGenerate the JSON response as described in the system prompt.`
          }
        ],
        max_tokens: 2000
      }, { signal });

      const rawContent = response.choices[0]?.message?.content || ""
      let structuredData = {
        short_answer: null as string | null, // Added field
        code: "",
        thoughts: ["Failed to parse AI response."],
        time_complexity: "N/A",
        space_complexity: "N/A"
      };

      try {
        let jsonToParse = rawContent.trim();
        // Check if the response is wrapped in markdown code fences and extract JSON
        if (jsonToParse.startsWith("```json") && jsonToParse.endsWith("```")) {
          jsonToParse = jsonToParse.substring(7, jsonToParse.length - 3).trim();
        } else if (jsonToParse.startsWith("```") && jsonToParse.endsWith("```")) {
           // Handle generic ``` ``` fences as well
           jsonToParse = jsonToParse.substring(3, jsonToParse.length - 3).trim();
        }

        // Attempt to parse the (potentially extracted) JSON
        const parsed = JSON.parse(jsonToParse);
        // Basic validation to ensure it has the expected structure (including optional short_answer)
        if (parsed && typeof parsed === 'object' && 'code' in parsed && 'thoughts' in parsed && 'time_complexity' in parsed && 'space_complexity' in parsed) {
          structuredData = {
            short_answer: parsed.short_answer || null, // Handle optional field
            code: parsed.code || "",
            thoughts: Array.isArray(parsed.thoughts) ? parsed.thoughts : [String(parsed.thoughts || `No thoughts provided in ${OPENAI_RESPONSE_LANGUAGE}.`)],
            time_complexity: parsed.time_complexity || "N/A",
            space_complexity: parsed.space_complexity || "N/A"
          };
        } else {
           // If parsing succeeds but structure is wrong, put raw content in thoughts
           structuredData.thoughts = [`Received unexpected structure from AI (in ${OPENAI_RESPONSE_LANGUAGE}):`, rawContent];
           structuredData.code = `// AI Response (unexpected format):\n${rawContent}`;
           structuredData.short_answer = null; // Ensure short_answer is null
        }
      } catch (parseError) {
        // If JSON parsing fails, return the raw string as 'code' and add a thought
         console.warn(`Failed to parse OpenAI response as JSON (language: ${OPENAI_RESPONSE_LANGUAGE}). Raw content:`, rawContent);
        // Improved error handling for non-JSON responses
        structuredData = {
          short_answer: null, // Ensure short_answer is null
          code: `// Error: Could not process the response from the AI.`,
          thoughts: [`The AI response could not be understood (expected JSON format). Response language set to ${OPENAI_RESPONSE_LANGUAGE}.`, "Raw AI Response:", rawContent],
          time_complexity: "N/A",
          space_complexity: "N/A"
        };
      }

      return { success: true, data: structuredData }
    } catch (error: any) {
      if (error.name === "CanceledError") {
        this.cancelOngoingRequests()
        this.deps.clearQueues()
        this.deps.setView("queue")
        const mainWindow = this.deps.getMainWindow()
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("reset-view")
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR,
            "Request timed out. The server took too long to respond. Please try again."
          )
        }
        return {
          success: false,
          error: "Request timed out. Please try again."
        }
      }

      console.error("Generate error details:", {
        message: error.message,
        code: error.code,
        response: error.response,
      })

      return { success: false, error: error.message }
    }
  }

  private async processExtraScreenshotsHelper(
    screenshots: Array<{ path: string; data: string }>,
    signal: AbortSignal
  ) {
    try {
      const imageDataList = screenshots.map((screenshot) => screenshot.data)
      const problemInfo = this.deps.getProblemInfo()
      const language = await this.getLanguage()

      if (!problemInfo) {
        throw new Error("No problem info available")
      }

      // Use the helper function for the API call
      const response = await this._callOpenAI("Debug", {
        model: OPENAI_MODEL,
        messages: [
          {
            role: "system",
            // Added response language to debug prompt
            content: `You are an expert debugger. Analyze and fix this code in ${language} language. Respond in ${OPENAI_RESPONSE_LANGUAGE}.`
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Problem: ${problemInfo.problem_statement}\n\nCurrent solution: ${problemInfo.solution}\n\nDebug this code.`
              },
              ...imageDataList.map(image => ({
                type: "image_url" as "image_url",
                image_url: { url: `data:image/jpeg;base64,${image}` }
              }))
            ]
          }
        ],
        max_tokens: 2000
      }, { signal });

      return { success: true, data: response.choices[0]?.message?.content || "" }
    } catch (error: any) {
      if (error.name === "CanceledError") {
        return {
          success: false,
          error: "Processing was canceled by the user."
        }
      }

      console.error("Debug error details:", {
        message: error.message,
        code: error.code,
        response: error.response,
      })

      return { success: false, error: error.message }
    }
  }

  public cancelOngoingRequests(): void {
    let wasCancelled = false

    if (this.currentProcessingAbortController) {
      this.currentProcessingAbortController.abort()
      this.currentProcessingAbortController = null
      wasCancelled = true
    }

    if (this.currentExtraProcessingAbortController) {
      this.currentExtraProcessingAbortController.abort()
      this.currentExtraProcessingAbortController = null
      wasCancelled = true
    }

    // Reset hasDebugged flag
    this.deps.setHasDebugged(false)

    // Clear any pending state
    this.deps.setProblemInfo(null)

    const mainWindow = this.deps.getMainWindow()
    if (wasCancelled && mainWindow && !mainWindow.isDestroyed()) {
      // Send a clear message that processing was cancelled
      mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS)
    }
  }

  public cancelProcessing(): void {
    if (this.currentProcessingAbortController) {
      this.currentProcessingAbortController.abort()
      this.currentProcessingAbortController = null
    }
    
    if (this.currentExtraProcessingAbortController) {
      this.currentExtraProcessingAbortController.abort()
      this.currentExtraProcessingAbortController = null
    }
  }
}
