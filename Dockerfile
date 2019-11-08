FROM node:12-alpine

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install

COPY . .

EXPOSE 3000

ENV INFINIUM_PORT=3000
ENV INFINIUM_WS_ENABLED=true
ENV INFINIUM_API_ENABLED=true
ENV INFINIUM_KEEP_OTHER_HISTORY=false
ENV INFINIUM_FORWARD_INTERVAL=900000
ENV INFINIUM_WEATHER_REFRESH_RATE=900000
ENV INFINIUM_DEBUG_MODE=false
ENV INFINIUM_DATA="/data/"
ENV INFINIUM_HISTORY_DATA="/data/history/"
#ENV INFINIUM_TZ=0


CMD [ "node", "launch.js" ]
