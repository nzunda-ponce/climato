import { repairGridRain } from "../src/providers/long-range";
repairGridRain()
  .then((result) => console.log(JSON.stringify(result)))
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
