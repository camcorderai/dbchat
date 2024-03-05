import "server-only";

import { createAI, createStreamableUI, getMutableAIState } from "ai/rsc";
import OpenAI from "openai";

import {
  spinner,
  BotCard,
  BotMessage,
  SystemMessage,
  Stock,
  Purchase,
  Stocks,
  Events,
} from "@/components/llm-stocks";

import {
  runAsyncFnWithoutBlocking,
  sleep,
  formatNumber,
  runOpenAICompletion,
} from "@/lib/utils";
import { z } from "zod";
import { StockSkeleton } from "@/components/llm-stocks/stock-skeleton";
import { EventsSkeleton } from "@/components/llm-stocks/events-skeleton";
import { StocksSkeleton } from "@/components/llm-stocks/stocks-skeleton";
import { fetchAllEventsWithProperties } from "./posthog";
import { supportedPHAggregates, supportedPHFunctions, supportedSQLTables } from "./supported";
import { Chart } from "./query-chart";
import { Code } from "bright";

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "",
});

import { Pool } from '@neondatabase/serverless';

export const chartTypes = ["table", "chart", "number"] as const;
export type ChartType = (typeof chartTypes)[number];

// const zOpenAIQueryResponse = z.object({
//   query: z.string().describe(`
//   Creates a HogQL ClickHouse SQL Query for the given query.
//   HogQL Rules:

//   HogQL is based on ClickHouse SQL.
  
//   The following ClickHouse functions are available:
//   ${supportedFunctions.join(", ")}

//   The following ClickHouse aggregate functions are available:
//   ${supportedAggregates.join(", ")}
  
//   Queries are case sensitive, respect the casing of the click house functions, properties and events.

//   If an event or property name has a space, it should be wrapped in quotes.
  
//   IMPORTANT: To filter to a specific event, use FROM events WHERE event = '{event_name}'
//   The only table that exists is events, every query will select from events.
  
//   To get events older than 5 days, use the expression:
  
//   dateDiff('day', timestamp, now()) > 5
  
//   IMPORTANT: Don't end queries with a semicolon.
    
//   Use inclusive matching unless explicitly stated otherwise, i.e strings including the value rather than equal to
//   For example, if you want to filter out all of Google events it would be: WHERE properties.{property_name} NOT LIKE '%Google%'
  
//   Make comparisons case insensitive by using the ILIKE operator. For example, WHERE properties.{property_name} ILIKE '%google%'

//   Timestamp is a DateTime type.
  
//   To count the number of events, you can use countIf(event = '{event_name}')

//   DO NOT USE BETWEEN for date ranges, it is not supported.

//   If breaking down data that isn't a timeseries, order it by descending count.
//   `),
//   format: z.enum(chartTypes).describe("The format of the result"),
//   title: z.string().optional().describe("The title of the chart"),
//   timeField: z
//     .string()
//     .optional()
//     .describe("If timeseries data, the column to use as the time field"),
// });

const zOpenAIQueryResponse = z.object({
  query: z.string().describe(`
  Create a PostgresSQL Query for the given query.
  Rules:

  The user has the following tables, with thier columns and data types:
  ${supportedSQLTables.map(table => 
    `${table.table_name}: ${table.columns.join(', ')}`
  ).join('\n')}

  These are the only tables and columns that exist. Do not use any other tables or column names.

  If the chart type is "chart", then label date columns as "date" and value columns as "value".

  Surround table names with double quotes.

  If breaking down data that isn't a timeseries, order it by descending count.
  `),
  format: z.enum(chartTypes).describe("The format of the result"),
  title: z.string().optional().describe("The title of the chart"),
  timeField: z
    .string()
    .optional()
    .describe("If timeseries data, the column to use as the time field"),
});

type OpenAIQueryResponse = z.infer<typeof zOpenAIQueryResponse>;

export type QueryResult = {
  columns: string[];
  results: (number | string)[][];
};

/* 
   Get tables and column names and types from the database
*/
async function getTables() {
  try {
    // const client = await sql.connect()
    
    // // Exclude VerificationToken table
    // const tables =
    //   await client.sql`select t.table_name, array_agg(c.column_name || ': ' || c.data_type::text) as columns from information_schema.tables t inner join information_schema.columns c on t.table_name = c.table_name where t.table_schema = 'public' and t.table_type= 'BASE TABLE' and c.table_schema = 'public' and t.table_name <> 'VerificationToken' group by t.table_name;`
    // client.release()
    // if (tables && tables.rows && tables.rows.length > 0) {
    //   return tables.rows;
    // }
    // else {
    //   return []
    // }
  }
  catch (e) {
    console.log("e", e)
    return []
  }
}

async function submitUserMessage(content: string, ctx: any) {
  "use server";
  const events = await fetchAllEventsWithProperties({
    posthogProjectId: process.env.POSTHOG_PROJECT_ID,
    posthogToken: process.env.POSTHOG_API_KEY,
  });
  const aiState = getMutableAIState<typeof AI>();
  aiState.update([
    ...aiState.get(),
    {
      role: "user",
      content,
    },
  ]);

  const reply = createStreamableUI(
    <BotMessage className="items-center">{spinner}</BotMessage>
  );

  // const stingifiedEvents = events
  //   .map(
  //     (event) => `"${event.name}": {
  //     ${event.properties.map((property) => `properties."${property.name}": ${property.type}`).join(", ")}
  //   }`
  //   )
  //   .join(", ")
  //   .replace("$sent_at", "timestamp");
  // const systemPrompt = `\
  // You are a data analytics bot for the product PostHog and you can help users query their data.
  // You and the user can discuss their events and the user can request to create new queries or refine existing ones, in the UI.
  
  // Messages inside [] means that it's a UI element or a user event. For example:
  // - "[Results for query: query with format: format and title: title and description: description. with data" means that a chart/table/number card is shown to that user.

  // The user has the following events and properties:
  // ${stingifiedEvents}
        
  // Keep the properties. prefix and the quotes around the property names when referring to properties.
  // Keep the quotes around the event names when referring to events.
  
  // The current time is ${new Date().toISOString()}.

  // Feel free to be creative with suggesting queries and follow ups based on what you think. Keep responses short and to the point.
  
  // `;

  const systemPrompt = `You are a data analytics bot named dbChat created by Camcorder AI. You can help users query their SQL database for insights.
  You and the user can discuss their data and the user can request to create new queries or refine existing ones, in the UI.

  You can only SELECT data to display it. You can't INSERT, UPDATE, or DELETE data.
  
  Messages inside [] means that it's a UI element or a user event. For example:
  - "[Results for query: query with format: format and title: title and description: description. with data" means that a chart/table/number card is shown to that user.
  
  The current time is ${new Date().toISOString()}.

  Feel free to be creative with suggesting queries and follow ups based on what you think. Keep responses short and to the point.
  `;

  const completion = runOpenAICompletion(openai, {
    model: "gpt-4-turbo-preview",
    stream: true,
    messages: [
      {
        role: "system",
        content: systemPrompt,
      },
      ...aiState.get().map((info: any) => ({
        role: info.role,
        content: info.content,
        name: info.name,
      })),
    ],
    functions: [
      {
        name: "query_data",
        description: `Gets the results for a query about the data
        `,
        parameters: zOpenAIQueryResponse,
      },
    ],
    temperature: 0,
  });

  completion.onTextContent(async (content: string, isFinal: boolean) => {
    const file = await unified()
      .use(remarkParse) // Convert into markdown AST
      .use(remarkRehype) // Transform to HTML AST
      .use(rehypeSanitize) // Sanitize HTML input
      .use(rehypeStringify) // Convert AST into serialized HTML
      .process(content);

    const html = file.toString();
    reply.update(
      <BotMessage>
        <div className="py-4" dangerouslySetInnerHTML={{ __html: html }}></div>
      </BotMessage>
    );
    if (isFinal) {
      reply.done();
      aiState.done([...aiState.get(), { role: "assistant", content }]);
    }
  });

  completion.onFunctionCall(
    "query_data",
    async (input: OpenAIQueryResponse) => {
      const { format, title, timeField } = input;
      let query = input.query;

      // replace $sent_at with timestamp
      // query = query.replace("$sent_at", "timestamp");

      // replace `properties."timestamp"` with `timestamp`
      // query = query.replace(/properties\."timestamp"/g, "timestamp");

      // gpt may generate like AVG( instead of avg( - we need to replace the functions with their intended case

      // const payload = {
      //   query: {
      //     kind: "HogQLQuery",
      //     query,
      //   },
      // };

      // const res = await fetch(
      //   `https://us.posthog.com/api/projects/${process.env.POSTHOG_PROJECT_ID}/query/`,
      //   {
      //     method: "POST",
      //     headers: {
      //       Authorization: `Bearer ${process.env.POSTHOG_API_KEY}`,
      //       "Content-Type": "application/json",
      //     },
      //     body: JSON.stringify(payload),
      //   }
      // );

      // const queryRes = (await res.json()) as QueryResult;

      console.log("query: ", query)

      let res
      let queryRes = {results: [], columns: []} as QueryResult
      
      try {
        // create a `Pool` inside the request handler
        const pool = new Pool({ connectionString: process.env.DATABASE_URL });

        // query and validate the post
        res = await pool.query(query);

        // end the `Pool` inside the same request handler 
        // (unlike `await`, `ctx.waitUntil` won't hold up the response)
        // ctx.waitUntil(pool.end());
        await pool.end();

        if (res && res.rows && res.fields) {

          if (format == "number") {
            queryRes.results.push(Object.values(res.rows[0])[0] as any)
          } else if (format == "chart") {
            queryRes.results = res.rows.map(item => {
              // Convert the UTC date to local date
              const timeZoneOffset = item.date.getTimezoneOffset() * 60000; // offset in milliseconds
              const localDate = new Date(item.date.getTime() - timeZoneOffset);
              return [
                localDate.toISOString().split("T")[0], // Extract the date part
                item.value
              ];
            }) as any
          } else if (format == "table") {
            queryRes.results = res.rows
          }
          queryRes.columns = res.fields.map((field: any) => field.name)
        } else {
          console.log("No results found.")
        }

        console.log("data: ", queryRes)

      } catch (err) {
        console.error(err)
      }

      reply.done(
        <BotCard>
          <SystemMessage>
            <div className="py-4">
              <Chart
                chartType={format}
                queryResult={queryRes}
                title={title}
                timeField={timeField}
              />
              <div className="py-4">
                <Code lang="sql">{query}</Code>
              </div>
            </div>
          </SystemMessage>
        </BotCard>
      );

      aiState.done([
        ...aiState.get(),
        {
          role: "function",
          name: "query_data",
          content: `[Results for query: ${query} with format: ${format} and title: ${title} with data ${queryRes.columns} ${queryRes.results}]`,
        },
      ]);
    }
  );

  return {
    id: Date.now(),
    display: reply.value,
  };
}

// Define necessary types and create the AI.

const initialAIState: {
  role: "user" | "assistant" | "system" | "function";
  content: string;
  id?: string;
  name?: string;
}[] = [];

const initialUIState: {
  id: number;
  display: React.ReactNode;
}[] = [];

export const AI = createAI({
  actions: {
    submitUserMessage,
  },
  initialUIState,
  initialAIState,
});
