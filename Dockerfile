FROM node:22-slim


WORKDIR /app


COPY demo_ts/package.json demo_ts/package-lock.json* ./ 


RUN npm install


COPY demo_ts/ .


CMD ["npx","ts-node","src/tools/baseline.ts"]
