# Here because we want to fetch the node_modules within docker so that it's
# installed on the same platform the test is run. Otherwise tools like `esbuild` will fail to run
FROM node:lts

WORKDIR /app

COPY package.json ./
COPY ./packages ./packages
COPY ./interop ./interop
COPY ./patches ./patches

# disable colored output and CLI animation from test runners
ENV CI=true

RUN npm i
RUN npm run build

WORKDIR /app/interop

ENTRYPOINT npm test -- -t node
