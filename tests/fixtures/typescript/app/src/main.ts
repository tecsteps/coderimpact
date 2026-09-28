import { Slugger, normalize } from "./slug";

const slugger = new Slugger(40);
console.log(slugger.make("Hello World"), normalize("A b"));
