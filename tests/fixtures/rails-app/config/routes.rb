Rails.application.routes.draw do
  root 'home#index'

  resource :inbox, only: [:create], module: :activitypub

  draw(:api)
end
