FROM node:lts as build

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build


FROM node:lts-slim

ENV NODE_ENV production
USER node
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY --from=build /app/dist ./dist

CMD ["node", "dist/server.js"]

EXPOSE 3000
