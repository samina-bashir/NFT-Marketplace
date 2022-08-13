;;implementedTrait
(impl-trait  .sip-009.sip009-nft-trait)

;;error constants
(define-constant invalid-token-id (err u89))

(define-non-fungible-token NFT uint)

;;maps
(define-map nft-data {id: uint }  (optional (string-ascii 256)))

;;variables
(define-data-var nft-count uint u0)

;;read-only functions
(define-read-only (get-last-token-id)
	(ok (var-get nft-count))
)
(define-read-only (get-token-uri (id uint))
    (ok (unwrap! (map-get? nft-data {id: id}) invalid-token-id))
)
(define-read-only (get-owner (id uint))
    (ok (nft-get-owner? NFT id))
)

;;public functions
(define-public (mint (recipient principal) (data (optional (string-ascii 256))) )
   (begin 
   (try! 
      (nft-mint? NFT (var-get nft-count) recipient)  
   )
   (map-insert nft-data {id: (var-get nft-count)} data)
   (var-set nft-count (var-get nft-count) + 1 )
   (ok true)
   )

)
(define-public (transfer (id uint) (sender principal) (recipient principal))
(begin
   (try! (nft-transfer? NFT id sender recipient))
   (ok true)
)
)


