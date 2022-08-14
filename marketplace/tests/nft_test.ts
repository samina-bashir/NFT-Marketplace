
import { Clarinet, Tx, Chain, Account, types } from 'https://deno.land/x/clarinet@v0.31.0/index.ts';
import { assertEquals } from 'https://deno.land/std@0.90.0/testing/asserts.ts';

Clarinet.test({
    name: "Ensure that minting is working!",
    async fn(chain: Chain, accounts: Map<string, Account>) {

        const deployer = accounts.get("deployer")!;
        const wallet2 = accounts.get("wallet_1")!;
      

        let block = chain.mineBlock([

            
           Tx.contractCall("nft", "mint", [ types.principal(deployer.address),types.some(types.ascii("ummar.jpeg"))], deployer.address)
          
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.height, 2);
        
        block.receipts[0].result.expectOk()
        .expectUint(0)

        
        assertEquals(block.receipts[0].events[0].type, 'nft_mint_event');
      
        block.receipts[0].events.expectNonFungibleTokenMintEvent(types.uint(0), deployer.address, 
        `${deployer.address}.nft`,"NFT")

    },
});
