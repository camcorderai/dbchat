  <h1 align="center">dbChat</h1>

<!-- ![image]() -->



<p align="center">
  Chat with your database using Text to SQL
</p>


## Running locally

Create a .env file with the following:
```env
OPENAI_API_KEY="sk-"
DATABASE_URL="postgres://USER:PASSWORD@POSTGRES_HOST:5432/DB_NAME?sslmode=require"
USERNAME="admin"
USER_PASSWORD="&gK4@#j!1!E#O"
```

Then run
```bash
bun i
bun dev
```

Your app should now be running on [localhost:3000](http://localhost:3000/).

## Authors

This app was created by [Philipp Tsipman @ Camcorder AI](https://github.com/camcorderai/dbchat).

It is based on [Rhys Sullivan's HogChat](https://github.com/RhysSullivan/hogchat) and the [Vercel AI RSC Demo](https://github.com/vercel/ai/tree/main/examples/next-ai-rsc).