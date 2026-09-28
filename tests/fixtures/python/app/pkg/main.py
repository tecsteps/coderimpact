from pkg.slug import Slugger, normalize

slugger = Slugger(40)
print(slugger.make("Hello World"), normalize("A b"))
