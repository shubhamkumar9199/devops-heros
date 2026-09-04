# build stage: needs the full JDK to compile
FROM eclipse-temurin:21-jdk AS build
WORKDIR /src
COPY HelloWorldServer.java ./
RUN javac HelloWorldServer.java

# run stage: JRE only, no compiler in the shipped image
FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /src/HelloWorldServer.class ./

EXPOSE 8000
CMD ["java", "HelloWorldServer"]
