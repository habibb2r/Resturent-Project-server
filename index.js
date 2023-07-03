const express = require('express');
const app = express();
const cors  = require('cors');
const port = process.env.PORT || 5000;
require('dotenv').config();
const jwt = require('jsonwebtoken');
const stripe = require('stripe')(process.env.PAYMENT_SECRET_KEY)


//middleware 
app.use(cors());
app.use(express.json());
const verifyJWT = (req, res, next) => {
  const authorization = req.headers.authorization;
  if(!authorization){
    return res.status(401).send({error: true, message: 'unauthorized'});
  }

  //bearer token
  const token = authorization.split(' ')[1];
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded)=>{
    if(err){
      return res.status(401).send({error: true, message: 'unauthorized'});
    }
    req.decoded = decoded;
    next();
  })
}



app.get('/', (req, res)=>{
    res.send('Running bistro boss ')
});


//DB

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.ir3lm70.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    //Collections 
    const menuCollection = client.db("bistroDB").collection("menu");
    const reviewsCollection = client.db("bistroDB").collection("reviews");
    const cartCollection = client.db("bistroDB").collection("carts");
    const userCollection = client.db("bistroDB").collection("users");
    const paymentCollection = client.db("bistroDB").collection("payments");


    //JWT
    app.post('/jwt', (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {expiresIn:'10d'})
      res.send({token})
    })

    //Verify Admin
    const verifyAdmin = async(req, res, next) => {
      const email = req.decoded.email;
      const query = {email: email};
      const user = await userCollection.findOne(query);
      if(user?.role !== 'admin'){
        return res.status(403).send({error : true, message : 'forbidden'});
      }
      next();
    }

    //User Collection 
    app.get('/users', verifyJWT, verifyAdmin, async (req, res) => {
      const result = await userCollection.find().toArray();
      res.send(result);
    })

    app.post('/users', async (req, res) => {
      const user = req.body;
      const query = {email: user.email}
      const existing = await userCollection.findOne(query);

      if(existing){
        return res.send({message: "User already exists"})
      }
      const result = await userCollection.insertOne(user);
      res.send(result);
    })

    app.get('/users/admin/:email', verifyJWT, async (req, res) => {
      const email = req.params.email;

      if(req.decoded.email !== email){
        return res.send({admin: false})
      }
      const query = {email: email}
      const user = await userCollection.findOne(query);
      const result = { admin: user?.role === 'admin'}
      return res.send(result)
    })

    app.patch('/users/admin/:id', async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id)};
      const updateDoc = {
        $set: {
          role: 'admin'
        },
      };
      const result = await userCollection.updateOne(filter, updateDoc);
      res.send(result);
    });



    //Menu Collection

    app.get('/menu', async (req, res) => {
        const result = await menuCollection.find().toArray();
        res.send(result);
    })
    app.get('/reviews', async (req, res) => {
        const result = await reviewsCollection.find().toArray();
        res.send(result);
    })
    
    app.post('/menu', verifyJWT, verifyAdmin, async (req, res) => {
      const newItem = req.body;
      console.log(newItem);
      const result = await menuCollection.insertOne(newItem)
      res.send(result);
    });

    app.delete('/menu/:id',  async (req,res) => {
      const id = req.params.id;
     
      const query = { _id: id };
      const result = await menuCollection.deleteOne(query);
     
      res.send(result);
    });

    // Cart Collection
    app.get('/carts', verifyJWT, async (req, res) => {
      const email = req.query.email;
      if(!email){
        res.send([]);
      }

      const decodedEmail = req.decoded.email;
      if(email !== decodedEmail){
        return res.status(403).send({error: true, message: 'Forbidden Access'})
      }

      const query = { email : email };
      const result = await cartCollection.find(query).toArray();
      res.send(result);
    });
    app.post('/carts', async (req, res) => {
      const item = req.body;
      const result = await cartCollection.insertOne(item);
      res.send(result);
    });
    app.delete('/carts/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await cartCollection.deleteOne(query);
      res.send(result);
    });
    
    // create payment intent
    app.post('/create-payment-intent', verifyJWT, async (req, res) =>{
      const {price } = req.body;
      const amount = price*100;

      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: 'usd',
        payment_method_types: ['card']
      });
      res.send({
        clientSecret: paymentIntent.client_secret
      })

    })

    // Get Payment History
    app.get('/payments', verifyJWT, async (req, res) => {
      const email = req.query.email;
      if(!email){
        res.send([]);
      }

      const decodedEmail = req.decoded.email;
      if(email !== decodedEmail){
        return res.status(403).send({error: true, message: 'Forbidden Access'})
      }

      const query = { email : email };
      const result = await paymentCollection.find(query).toArray();
      res.send(result);
    });

    //Payment DB 
    app.post('/payments', verifyJWT, async (req, res) =>{
      const payment = req.body;
      const insertResult = await paymentCollection.insertOne(payment);

      const query = {_id : { $in: payment.cartItems.map(id => new ObjectId(id))}}
      const deleteCart = await cartCollection.deleteMany(query);
      res.send({insertResult, deleteCart});
    })

    // Dashboard
    app.get('/admin-states', async (req, res) =>{
      const users = await userCollection.estimatedDocumentCount();
      const products = await menuCollection.estimatedDocumentCount();
      const orders = await paymentCollection.estimatedDocumentCount();
      const payments = await paymentCollection.find().toArray();
      const revenue = payments.reduce((sum, payment)=> sum + payment.price , 0)
      res.send({users, products, orders,revenue});    
    })
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
   
  }
}
run().catch(console.dir);


app.listen(port, ()=> {
    console.log(`bisro boss server port: ${port}`);
})