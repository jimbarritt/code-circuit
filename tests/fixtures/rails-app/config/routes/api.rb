namespace :api, format: false do
  namespace :v1 do
    resources :statuses, only: [:index, :create, :show] do
      scope module: :statuses do
        resource :favourite, only: :create
        post :unfavourite, to: 'favourites#destroy'
      end
    end

    namespace :timelines do
      resource :home, only: :show, controller: :home
    end

    resources :accounts, only: [:show] do
      member do
        post :follow
      end
    end

    resources :notifications, only: [:index] do
      collection do
        post :clear
      end
    end
  end
end
